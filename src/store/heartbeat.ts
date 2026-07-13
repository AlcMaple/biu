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
  /** UP 反馈分：越高续供越优先；被「不喜欢」的 UP 会被压低 */
  ownerScore: Record<number, number>;
  /** 开始一次心动会话（每次进入都会重开，打断当前播放） */
  start: () => Promise<StartResult>;
  /** 结束心动会话 */
  stop: () => void;
  /** 结束心动会话并把播放队列整体替换成给定歌单（用于「转去播放某个歌单」） */
  stopAndReplace: (medias: PlayItem[], startFrom?: PlayItem) => void;
  /** 把当前播放的歌加入/移出「我喜欢的音乐」 */
  toggleLikeCurrent: () => "added" | "removed" | null;
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

export const useHeartbeat = create<HeartbeatState>((set, get) => ({
  active: false,
  loading: false,
  servedBvids: new Set(),
  servedKeys: new Set(),
  sessionIds: new Set(),
  ownerScore: {},

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

      const { likedBvids, ownerScore } = likedContext();
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
      const sessionIds = new Set(usePlayList.getState().list.map(it => it.id));

      set({ active: true, loading: false, servedBvids: served, servedKeys, sessionIds, ownerScore });
      persistServed(served, servedKeys);
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
    lastPlayId = state.playId;
    void maybeTopup();
  });
}

async function maybeTopup() {
  if (toppingUp) return;
  const hb = useHeartbeat.getState();
  if (!hb.active) return;

  const { list, playId } = usePlayList.getState();

  // 队列是否仍属于本会话：按 play-list 内部 id 判断（不看 bvid）。
  // 搜索/全网插播时会话原有 id 仍在 → 继续；点歌单（播放全部或点单曲）整队替换 → id 全变 → 自动结束心动会话。
  const inSession = list.some(it => hb.sessionIds.has(it.id));
  if (!inSession) {
    useHeartbeat.getState().stop();
    return;
  }

  const idx = list.findIndex(it => it.id === playId);
  const remaining = idx < 0 ? list.length : list.length - idx - 1;
  if (remaining > TOPUP_THRESHOLD) return;

  toppingUp = true;
  try {
    const { likedBvids } = likedContext();
    // 二度扩展：拿几首已服务过的候选当新的「看了又看」种子，持续引入新 UP，避免只在红心的同 UP 里打转
    const secondDegree: Seed[] = [...hb.servedBvids]
      .slice(-40)
      .sort(() => Math.random() - 0.5)
      .slice(0, SECOND_DEGREE_SEEDS)
      .map(bvid => ({ bvid }));

    const allSeeds = [...nextSeeds(MAX_SEEDS), ...secondDegree];
    const exclude = new Set<string>([...likedBvids, ...hb.servedBvids]);
    const pool = await buildCandidatePool(allSeeds, {
      exclude,
      excludeKeys: hb.servedKeys,
      maxSeeds: allSeeds.length,
      doVerify: true,
    });
    if (!pool.length) return;

    // 反馈重排：偏好红心里出现更多的 UP（被「不喜欢」的 UP 会被压低）
    const ranked = [...pool].sort(
      (a, b) => (hb.ownerScore[b.ownerMid ?? -1] ?? 0) - (hb.ownerScore[a.ownerMid ?? -1] ?? 0),
    );

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
  } catch (e) {
    console.error("[heartbeat] top-up failed", e);
  } finally {
    toppingUp = false;
  }
}
