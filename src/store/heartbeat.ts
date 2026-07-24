import { create } from "zustand";

import { PlayMode } from "@/common/constants/audio";
import {
  INITIAL_QUEUE_TARGET,
  LIKED_FOLDER_ID,
  MAX_SEEDS,
  MAX_SERVED_HISTORY,
  SECOND_DEGREE_SEEDS,
  SIMILAR_PER_LIKED,
  TOPUP_BATCH,
  TOPUP_THRESHOLD,
} from "@/common/constants/heartbeat";
import { addOnlineItemToLocalFav, getLocalFavMedia } from "@/common/utils/fav";
import { songKey, type SongCandidate } from "@/common/utils/pure-song";
import platform from "@/platform";
import { buildCandidatePool, clearHeartbeatCache, type Seed } from "@/service/heartbeat/candidate-engine";
import { getFavSeeds, recordFavoritedSong, type FavSeed } from "@/service/heartbeat/fav-seeds";
import { useLocalFavItemsStore } from "@/store/local-fav-items";
import { usePlayList, type PlayItem } from "@/store/play-list";
import { StoreNameMap } from "@shared/store";

/** start() 的结果，交给页面决定提示文案 */
export type StartResult = "ok" | "likes-only" | "empty" | "error";

interface HeartbeatState {
  /** 心动会话是否进行中 */
  active: boolean;
  /** 是否正在构建队列 */
  loading: boolean;
  /** 已服务过的候选 bvid（避免重复推荐，含持久化的跨会话历史） */
  servedBvids: Set<string>;
  /** 已服务过的歌曲指纹（同名去重） */
  servedKeys: Set<string>;
  /** 本会话在播放队列里的 PlayData id 集合（判断当前队列是否仍属于本次心动会话） */
  sessionIds: Set<string>;
  /** 心动会话是否仍在场（进入 FM 页时用它决定「接着放」还是「重开一轮」） */
  isSessionLive: () => boolean;
  /** 开始一次心动会话（重开一轮，打断当前播放） */
  start: () => Promise<StartResult>;
  /** 结束心动会话 */
  stop: () => void;
  /** 结束心动会话并把播放队列整体替换成给定歌单（用于「转去播放某个歌单」） */
  stopAndReplace: (medias: PlayItem[], startFrom?: PlayItem) => void;
  /** 把当前播放的歌加入/移出「我喜欢的音乐」 */
  toggleLikeCurrent: () => "added" | "removed" | null;
  /** 在 FM 播放时收藏了一首 FM 推荐过的歌 → 记为二度扩展种子（强正反馈，非 FM 推荐/非 FM 时不记） */
  noteFavoriteFromFm: (seed: FavSeed) => void;
}

/** 随机打乱（Fisher-Yates） */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function candToPlayItem(c: SongCandidate): PlayItem {
  return {
    type: "mv",
    bvid: c.bvid,
    title: c.title,
    cover: c.cover,
    ownerMid: c.ownerMid,
    ownerName: c.ownerName,
    playCount: c.play,
  };
}

/** 两个播放项是否同一首（用于把歌单旋转到点击的那首起播） */
function sameItem(a: PlayItem, b: PlayItem): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "mv") return Boolean(a.bvid) && a.bvid === b.bvid;
  if (a.type === "audio") {
    return (a.sid !== undefined && a.sid === b.sid) || (a.source === "local" && Boolean(a.id) && a.id === b.id);
  }
  return false;
}

/**
 * 交织：以相似歌起手（尽量少插红心），每 SIMILAR_PER_LIKED 首相似歌后穿插 1 首红心歌。
 * 每首红心歌至多出现一次；整段一次都没插到时在开头附近补 1 首，保证「红心尽量少但不能没有」。
 */
function interleave(likes: PlayItem[], sims: PlayItem[]): PlayItem[] {
  if (!sims.length) return likes;
  if (!likes.length) return sims;

  const out: PlayItem[] = [];
  let li = 0;
  let sinceLike = 0;
  let insertedLike = false;

  for (const s of sims) {
    out.push(s);
    sinceLike++;
    if (sinceLike >= SIMILAR_PER_LIKED && li < likes.length) {
      out.push(likes[li++]);
      sinceLike = 0;
      insertedLike = true;
    }
  }

  if (!insertedLike) {
    out.splice(Math.min(1, out.length), 0, likes[0]);
  }
  return out;
}

// ⚠️ 临时调试输出，验证过滤/交织效果后删除本函数及其调用
function debugDumpQueue(pool: SongCandidate[], queue: PlayItem[], simBvids: Set<string>) {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return;
  console.group(`[heartbeat] 候选池 ${pool.length} 首 / 队列 ${queue.length} 首`);
  console.table(pool.map(c => ({ 标题: c.title, 时长秒: c.durationSec, UP: c.ownerName ?? "" })));
  console.log(
    "队列顺序：",
    queue.map(it => `${it.bvid && simBvids.has(it.bvid) ? "相似" : "红心"}·${it.title}`).join("  |  "),
  );
  console.groupEnd();
}

// ⚠️ 临时调试输出：私人FM 按切歌逐首写进 logs/heartbeat 文件（只在开发期），验证过后一并删除。
// 不再一次性 dump 整个队列：重开一轮开新文件，之后每次切歌把「刚切走的那首」追加一行，行首带它在播放队列里的序号。
// 按「队列项」去重（同一项只记一次）：反复上/下一首在同两首间来回切不会重复记；而续供真喂来重复歌是新队列项、
// 序号不同 → 照记（例：第 1 首和第 6 首都叫 A，日志里就是两条不同序号的 A），不会被误当去重藏掉。
function isDevLog() {
  return !(typeof process !== "undefined" && process.env.NODE_ENV === "production");
}

/** 本轮已记过的「队列项 id」（去重用）：只挡同一项的反复切换，不挡续供喂来的新重复歌 */
const loggedSongIds = new Set<string>();

/** 重开一轮：清空去重集、让主进程开一个新日志文件（写轮次头） */
function startFmDebugLog() {
  if (!isDevLog()) return;
  loggedSongIds.clear();
  try {
    void platform.heartbeatDebugLog({ reset: true });
  } catch {
    /* 纯调试，失败静默，不影响播放 */
  }
}

/** 追加一条「刚切走的那首」到当前轮文件：seq = 它在播放队列里的序号（1 起） */
function appendSwitchedSong(seq: number, title: string) {
  if (!isDevLog()) return;
  try {
    void platform.heartbeatDebugLog({ seq, song: title });
  } catch {
    /* 纯调试，失败静默，不影响播放 */
  }
}

/**
 * 心动会话是否仍在场：active 且播放队列里仍有本会话的歌。
 *
 * 按 play-list 内部 id 判断（不看 bvid）：搜索 / 全网插播时会话原有 id 仍在 → 仍在场；
 * 点歌单（播放全部或点单曲）整队替换 → id 全变 → 已离场。
 */
function sessionLive(): boolean {
  const hb = useHeartbeat.getState();
  if (!hb.active) return false;
  return usePlayList.getState().list.some(it => hb.sessionIds.has(it.id));
}

// —— 红心种子上下文 ——

function likedItems() {
  return useLocalFavItemsStore
    .getState()
    .getItems(LIKED_FOLDER_ID)
    .filter(i => !i.invalid);
}

function likedContext() {
  const items = likedItems();
  const likedBvids = new Set<string>(items.map(i => i.bvid).filter((b): b is string => Boolean(b)));
  const ownerScore: Record<number, number> = {};
  items.forEach(i => {
    if (i.ownerMid) ownerScore[i.ownerMid] = (ownerScore[i.ownerMid] ?? 0) + 1;
  });
  return { items, likedBvids, ownerScore };
}

// —— 种子轮转：一次会话把红心歌单里所有能当种子的歌分批轮着用，保证不漏任何一首 ——

let seedOrder: Seed[] = [];
let seedCursor = 0;

function resetSeedRotation() {
  seedOrder = shuffle(likedItems().filter(i => i.bvid || i.ownerMid)).map(i => ({
    bvid: i.bvid,
    ownerMid: i.ownerMid,
    title: i.title,
  }));
  seedCursor = 0;
}

/** 取下一批种子（轮转，用完一轮从头继续，覆盖全部红心） */
function nextSeeds(count: number): Seed[] {
  if (!seedOrder.length) resetSeedRotation();
  if (!seedOrder.length) return [];
  const n = Math.min(count, seedOrder.length);
  const out: Seed[] = [];
  for (let k = 0; k < n; k++) {
    out.push(seedOrder[(seedCursor + k) % seedOrder.length]);
  }
  seedCursor = (seedCursor + n) % seedOrder.length;
  return out;
}

// —— 已推历史持久化（跨会话/跨天不重复推荐） ——

async function loadServed(): Promise<{ bvids: string[]; keys: string[] }> {
  try {
    const s = (await platform.getStore(StoreNameMap.HeartbeatServed)) as
      | { bvids?: string[]; keys?: string[] }
      | undefined;
    return { bvids: s?.bvids ?? [], keys: s?.keys ?? [] };
  } catch {
    return { bvids: [], keys: [] };
  }
}

function persistServed(bvids: Set<string>, keys: Set<string>) {
  void platform.setStore(StoreNameMap.HeartbeatServed, {
    bvids: [...bvids].slice(-MAX_SERVED_HISTORY),
    keys: [...keys].slice(-MAX_SERVED_HISTORY),
  });
}

// —— 会话持久化：重启后接着放 ——
//
// 本 store 是纯内存的，play-list 却是持久化的。不存会话，重启后两边就错位：上次 FM 的队列
// 还在、还能播，但 active/sessionIds 归零、续供订阅也没挂 —— 那队歌就成了「看着是 FM、实则
// 续供已死」的死循环，且进 FM 页会被重开一轮打断。

async function loadSession(): Promise<{ active: boolean; sessionIds: string[] }> {
  try {
    const s = (await platform.getStore(StoreNameMap.HeartbeatSession)) as
      | { active?: boolean; sessionIds?: string[] }
      | undefined;
    return { active: s?.active ?? false, sessionIds: s?.sessionIds ?? [] };
  } catch {
    return { active: false, sessionIds: [] };
  }
}

function persistSession(active: boolean, sessionIds: Set<string>) {
  // 只存当前队列里还在的 id：判「会话是否在场」只需要它们，而 sessionIds 会随会话一路累积
  const live = active
    ? usePlayList
        .getState()
        .list.map(it => it.id)
        .filter(id => sessionIds.has(id))
    : [];
  void platform.setStore(StoreNameMap.HeartbeatSession, { active, sessionIds: live });
}

/**
 * 重启后恢复上次的心动会话，让 FM「接着放」而不是重开一轮。
 *
 * 幂等：已在会话中直接返回；未恢复则重放同样的读取，多调一次只是重复一次只读 IPC。
 * PlayBar 启动即调；FM 页挂载 `await restoreSession()` 后再判「接着放 / 重开」，杜绝
 * 「恢复还没 settle 就被判成不在场而重开」的竞态（二者并发也安全：attachTopup 先 detach，不会重复订阅）。
 *
 * 只能在主窗触发（PlayBar 只在主窗挂载；FM 路由也只在主窗布局内）：三个窗口共用一个 bundle，
 * 每个窗口都恢复的话会各挂一个续供订阅 → 队列见底时重复抓取、重复入队。
 */
export async function restoreSession() {
  if (useHeartbeat.getState().active) return; // 已在会话中：不重复恢复
  const { active, sessionIds } = await loadSession();
  if (!active || !sessionIds.length) return;

  // play-list 走默认 localStorage（同步水合），此处 list 已是恢复后的队列
  const ids = new Set(sessionIds);
  if (!usePlayList.getState().list.some(it => ids.has(it.id))) {
    persistSession(false, new Set()); // 队列已被换掉（退出前点了别的歌单）：会话不在场，清掉标记
    return;
  }

  const hist = await loadServed(); // 续供靠它去重，不载回会把听过的重新推一遍
  useHeartbeat.setState({
    active: true,
    sessionIds: ids,
    servedBvids: new Set(hist.bvids),
    servedKeys: new Set(hist.keys),
  });
  attachTopup(); // 续供订阅原本只在 start() 里挂，重启后必须重挂，否则播完就成死循环
}

export const useHeartbeat = create<HeartbeatState>((set, get) => ({
  active: false,
  loading: false,
  servedBvids: new Set(),
  servedKeys: new Set(),
  sessionIds: new Set(),

  isSessionLive: () => sessionLive(),

  start: async () => {
    if (get().loading) return "error";
    set({ loading: true });

    try {
      const likes = getLocalFavMedia(LIKED_FOLDER_ID);
      if (!likes.length) {
        set({ loading: false });
        return "empty";
      }

      clearHeartbeatCache(); // 新会话：清掉上一会话的同 UP/看了又看缓存
      resetSeedRotation();

      const hist = await loadServed(); // 跨会话已推历史
      const served = new Set<string>(hist.bvids);
      const servedKeys = new Set<string>(hist.keys);

      const { likedBvids } = likedContext();
      const seeds = nextSeeds(MAX_SEEDS);
      const exclude = new Set<string>([...likedBvids, ...served]); // 排除红心 + 历史已推
      const pool = await buildCandidatePool(seeds, { exclude, excludeKeys: servedKeys, doVerify: true });

      const sims = shuffle(pool).map(candToPlayItem);
      pool.forEach(c => {
        served.add(c.bvid);
        servedKeys.add(songKey(c.title));
      });

      // 循环模式播放，保住交织顺序（随机模式会打乱穿插比例）
      const audio = usePlayList.getState().getAudio();
      audio.loop = false;
      usePlayList.setState({ playMode: PlayMode.Loop });

      const queue = sims.length ? interleave(shuffle(likes), sims).slice(0, INITIAL_QUEUE_TARGET) : shuffle(likes);
      debugDumpQueue(pool, queue, new Set(pool.map(c => c.bvid)));

      await usePlayList.getState().playList(queue);
      startFmDebugLog(); // 重开一轮：开新日志文件（之后每首播放完追加一行）
      const sessionIds = new Set(usePlayList.getState().list.map(it => it.id));

      set({ active: true, loading: false, servedBvids: served, servedKeys, sessionIds });
      persistServed(served, servedKeys);
      persistSession(true, sessionIds);
      attachTopup();

      return sims.length ? "ok" : "likes-only";
    } catch (e) {
      console.error("[heartbeat] start failed", e);
      set({ loading: false });
      return "error";
    }
  },

  stop: () => {
    detachTopup();
    set({ active: false });
    persistSession(false, new Set());
  },

  stopAndReplace: (medias, startFrom) => {
    get().stop();
    let ordered = medias;
    if (startFrom) {
      const idx = medias.findIndex(m => sameItem(m, startFrom));
      if (idx > 0) ordered = [...medias.slice(idx), ...medias.slice(0, idx)];
    }
    void usePlayList.getState().playList(ordered);
  },

  toggleLikeCurrent: () => {
    const cur = usePlayList.getState().getPlayItem();
    if (!cur || cur.type !== "mv" || !cur.bvid) return null;

    const store = useLocalFavItemsStore.getState();
    const rid = cur.aid ? Number(cur.aid) : cur.bvid;
    if (store.hasItem(LIKED_FOLDER_ID, rid)) {
      store.removeItem(LIKED_FOLDER_ID, rid);
      return "removed";
    }
    addOnlineItemToLocalFav(LIKED_FOLDER_ID, {
      rid,
      type: 2,
      source: "online",
      title: cur.title,
      cover: cur.cover,
      bvid: cur.bvid,
      ownerName: cur.ownerName,
      ownerMid: cur.ownerMid,
      duration: cur.duration,
      playCount: cur.playCount,
    });
    return "added";
  },

  noteFavoriteFromFm: seed => {
    const st = get();
    // 双门槛：① FM 正在播放；② 收藏的是 FM 推荐过的歌（在 servedBvids 里 —— 红心种子被排除在候选外，
    // 不会进 servedBvids，所以这里天然只认「FM 推的、非红心的」歌）。二者皆满足才记为二度扩展种子。
    if (!st.active || !seed.bvid || !st.servedBvids.has(seed.bvid)) return;
    void recordFavoritedSong(seed);
  },
}));

// —— 续供：订阅播放队列，接近播完时追加更多相似歌 ——

let unsub: (() => void) | null = null;
let lastPlayId: string | undefined;
let toppingUp = false;

function detachTopup() {
  if (unsub) {
    unsub();
    unsub = null;
  }
}

function attachTopup() {
  detachTopup();
  lastPlayId = usePlayList.getState().playId;
  unsub = usePlayList.subscribe(state => {
    if (state.playId === lastPlayId) return; // 仅在切歌时处理，避免进度/播放态变更频繁触发
    const leftId = lastPlayId; // 刚被切走的那首
    lastPlayId = state.playId;
    // 按切歌记录：把刚切走那首追加一行，带它在播放队列里的序号；同一队列项只记一次
    //（挡「反复上/下一首来回切」的重复；续供真喂来的重复歌是新队列项、序号不同 → 照记，不会被藏）。
    // 按 id 回查队列位置：正常切歌能查到；队列被替换 / 该项已移除（失效跳过、bvid-only 占位解析换 id）时 -1 → 不记。
    if (leftId && !loggedSongIds.has(leftId)) {
      const idx = state.list.findIndex(it => it.id === leftId);
      if (idx >= 0) {
        loggedSongIds.add(leftId);
        appendSwitchedSong(idx + 1, state.list[idx].title);
      }
    }
    void maybeTopup();
  });
}

/**
 * 二度扩展种子 = 用户「在 FM 里收藏的 FM 推荐歌」（强正反馈：FM 推了、你还收藏了 → 顺着它找更多同类）。
 * 来自 `noteFavoriteFromFm` 记的收藏动作缓冲（带 bvid/ownerMid/title → 喂全部三腿），跨会话持久。
 * 顺着用户明确认可的推荐扩展，不像「拿 FM 自产候选」那样漂。
 */
async function favoriteSeeds(limit: number): Promise<Seed[]> {
  const buffered = await getFavSeeds();
  return shuffle(buffered)
    .slice(0, limit)
    .map(s => ({ bvid: s.bvid, ownerMid: s.ownerMid, title: s.title }));
}

async function maybeTopup() {
  if (toppingUp) return;
  const hb = useHeartbeat.getState();
  if (!hb.active) return;

  // 队列已被点歌单整队替换 → 自动结束心动会话
  if (!sessionLive()) {
    useHeartbeat.getState().stop();
    return;
  }

  const { list, playId } = usePlayList.getState();
  const idx = list.findIndex(it => it.id === playId);
  const remaining = idx < 0 ? list.length : list.length - idx - 1;
  if (remaining > TOPUP_THRESHOLD) return;

  toppingUp = true;
  try {
    const { likedBvids, ownerScore } = likedContext();
    // 二度扩展：先用「FM 里被收藏的推荐歌」（强正反馈，全元数据 → 喂三腿）；不够 SECOND_DEGREE_SEEDS 个时，
    // 用弱路径「最近已推候选随机抽」补齐剩余名额（仅带 bvid → 只喂看了又看；种子是 FM 自产、可能漂）。
    const favSeeds = await favoriteSeeds(SECOND_DEGREE_SEEDS);
    const need = SECOND_DEGREE_SEEDS - favSeeds.length;
    const favBvids = new Set(favSeeds.map(s => s.bvid));
    const servedFill: Seed[] =
      need > 0
        ? [...hb.servedBvids]
            .filter(b => !favBvids.has(b))
            .slice(-40)
            .sort(() => Math.random() - 0.5)
            .slice(0, need)
            .map(bvid => ({ bvid }))
        : [];
    const secondDegree: Seed[] = [...favSeeds, ...servedFill];

    const allSeeds = [...nextSeeds(MAX_SEEDS), ...secondDegree];
    const exclude = new Set<string>([...likedBvids, ...hb.servedBvids]);
    const pool = await buildCandidatePool(allSeeds, {
      exclude,
      excludeKeys: hb.servedKeys,
      maxSeeds: allSeeds.length,
      doVerify: true,
    });
    if (!pool.length) return;

    // 反馈重排：偏好红心里出现更多的 UP（被「不喜欢」的 UP 会被压低）。
    // 就地从红心算（likedContext 上面已调），不存快照：会话期间新加的红心即时生效，
    // 重启恢复会话时也不必再把它捞回来。
    const ranked = [...pool].sort((a, b) => (ownerScore[b.ownerMid ?? -1] ?? 0) - (ownerScore[a.ownerMid ?? -1] ?? 0));

    const picked = ranked.slice(0, TOPUP_BATCH);
    const batch = picked.map(candToPlayItem);
    debugDumpQueue(picked, batch, new Set(picked.map(c => c.bvid)));
    usePlayList.getState().addList(batch);

    const cur = useHeartbeat.getState();
    const served = new Set(cur.servedBvids);
    const servedKeys = new Set(cur.servedKeys);
    picked.forEach(c => {
      served.add(c.bvid);
      servedKeys.add(songKey(c.title));
    });
    const sessionIds = new Set([...cur.sessionIds, ...usePlayList.getState().list.map(it => it.id)]);
    useHeartbeat.setState({ servedBvids: served, servedKeys, sessionIds });
    persistServed(served, servedKeys);
    persistSession(true, sessionIds);
  } catch (e) {
    console.error("[heartbeat] top-up failed", e);
  } finally {
    toppingUp = false;
  }
}
