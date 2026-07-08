import { create } from "zustand";

import { PlayMode } from "@/common/constants/audio";
import {
  INITIAL_QUEUE_TARGET,
  LIKED_FOLDER_ID,
  MAX_SEEDS,
  SIMILAR_PER_LIKED,
  TOPUP_BATCH,
  TOPUP_THRESHOLD,
} from "@/common/constants/heartbeat";
import { getLocalFavMedia } from "@/common/utils/fav";
import { type SongCandidate } from "@/common/utils/pure-song";
import { buildCandidatePool, type Seed } from "@/service/heartbeat/candidate-engine";
import { useLocalFavItemsStore } from "@/store/local-fav-items";
import { usePlayList, type PlayItem } from "@/store/play-list";

/** start() 的结果，交给页面决定提示文案 */
export type StartResult = "ok" | "likes-only" | "empty" | "error";

interface HeartbeatState {
  /** 心动会话是否进行中 */
  active: boolean;
  /** 是否正在构建队列 */
  loading: boolean;
  /** 已服务过的候选 bvid（避免重复推荐） */
  servedBvids: Set<string>;
  /** 本会话红心种子的 bvid（用于判断当前队列是否仍是本会话） */
  sessionBvids: Set<string>;
  /** UP 反馈分：种子里出现越多分越高，续供时优先推这些 UP 的歌 */
  ownerScore: Record<number, number>;
  start: () => Promise<StartResult>;
  stop: () => void;
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
  };
}

/**
 * 交织：以相似歌起手（尽量少插红心），每 SIMILAR_PER_LIKED 首相似歌后穿插 1 首红心歌。
 * 每首红心歌至多出现一次。若相似歌太少、整段一次都没插到红心，则在开头附近补 1 首，
 * 保证「红心尽量少但不能没有」。
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

/** 从红心歌单取种子（采样、需带 bvid 或 ownerMid） */
function collectSeeds(): { seeds: Seed[]; likedBvids: Set<string>; ownerScore: Record<number, number> } {
  const items = useLocalFavItemsStore
    .getState()
    .getItems(LIKED_FOLDER_ID)
    .filter(i => !i.invalid);

  const likedBvids = new Set<string>(items.map(i => i.bvid).filter((b): b is string => Boolean(b)));

  const ownerScore: Record<number, number> = {};
  items.forEach(i => {
    if (i.ownerMid) ownerScore[i.ownerMid] = (ownerScore[i.ownerMid] ?? 0) + 1;
  });

  const seeds: Seed[] = shuffle(items)
    .filter(i => i.bvid || i.ownerMid)
    .slice(0, MAX_SEEDS)
    .map(i => ({ bvid: i.bvid, ownerMid: i.ownerMid }));

  return { seeds, likedBvids, ownerScore };
}

export const useHeartbeat = create<HeartbeatState>((set, get) => ({
  active: false,
  loading: false,
  servedBvids: new Set(),
  sessionBvids: new Set(),
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

      const { seeds, likedBvids, ownerScore } = collectSeeds();
      const pool = await buildCandidatePool(seeds, { exclude: likedBvids, doVerify: true });

      const sims = shuffle(pool).map(candToPlayItem);
      const served = new Set<string>(pool.map(c => c.bvid));

      // 循环模式播放，保住交织顺序（随机模式会打乱穿插比例）
      const audio = usePlayList.getState().getAudio();
      audio.loop = false;
      usePlayList.setState({ playMode: PlayMode.Loop });

      const queue = sims.length ? interleave(shuffle(likes), sims).slice(0, INITIAL_QUEUE_TARGET) : shuffle(likes);

      debugDumpQueue(pool, queue, served);

      await usePlayList.getState().playList(queue);

      set({
        active: true,
        loading: false,
        servedBvids: served,
        sessionBvids: likedBvids,
        ownerScore,
      });
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

  // 队列是否仍是本会话：还含有服务过的/红心的曲目。若用户改播了别的东西，自动结束心动会话。
  const inSession = list.some(it => it.bvid && (hb.servedBvids.has(it.bvid) || hb.sessionBvids.has(it.bvid)));
  if (!inSession) {
    useHeartbeat.getState().stop();
    return;
  }

  const idx = list.findIndex(it => it.id === playId);
  const remaining = idx < 0 ? list.length : list.length - idx - 1;
  if (remaining > TOPUP_THRESHOLD) return;

  toppingUp = true;
  try {
    const { seeds } = collectSeeds();
    const exclude = new Set<string>([...hb.sessionBvids, ...hb.servedBvids]);
    const pool = await buildCandidatePool(seeds, { exclude, doVerify: true });
    if (!pool.length) return;

    // 反馈重排：偏好红心里出现更多的 UP
    const ranked = [...pool].sort(
      (a, b) => (hb.ownerScore[b.ownerMid ?? -1] ?? 0) - (hb.ownerScore[a.ownerMid ?? -1] ?? 0),
    );

    const batch = ranked.slice(0, TOPUP_BATCH).map(candToPlayItem);
    debugDumpQueue(ranked.slice(0, TOPUP_BATCH), batch, new Set(ranked.map(c => c.bvid)));
    usePlayList.getState().addList(batch);

    const served = new Set(useHeartbeat.getState().servedBvids);
    ranked.forEach(c => served.add(c.bvid));
    useHeartbeat.setState({ servedBvids: served });
  } catch (e) {
    console.error("[heartbeat] top-up failed", e);
  } finally {
    toppingUp = false;
  }
}
