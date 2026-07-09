import { chunk } from "es-toolkit/array";

import { MAX_SEEDS, PER_SEED_RELATED, PER_SEED_SPACE, PER_UP_CAP, VERIFY_LIMIT } from "@/common/constants/heartbeat";
import { isPureSongCandidate, isSameSong, songKey, toSeconds, type SongCandidate } from "@/common/utils/pure-song";
import { getSpaceWbiArcSearch } from "@/service/space-wbi-arc-search";
import { getWebInterfaceArchiveRelated } from "@/service/web-interface-archive-related";
import { getWebInterfaceView } from "@/service/web-interface-view";

/** 一个种子：来自红心歌单里的一首歌，或续供时的二度扩展种子 */
export interface Seed {
  bvid?: string;
  ownerMid?: number;
}

export interface BuildOptions {
  /** 排除这些 bvid（红心里已有 / 已服务过的） */
  exclude: Set<string>;
  /** 排除这些歌曲指纹（同名去重，跨来源/跨续供） */
  excludeKeys?: Set<string>;
  /** 用作候选来源的种子数量上限 */
  maxSeeds?: number;
  /** 是否做 Stage 2 view 核验（剔除多 P/合集、用精确字段复筛） */
  doVerify?: boolean;
}

// —— 会话级缓存：同一会话内对同一 mid/bvid 只请求一次，避免续供反复打同样接口（省请求、防风控） ——
const spaceCache = new Map<number, SongCandidate[]>();
const relatedCache = new Map<string, SongCandidate[]>();

/** 新会话开始时清空缓存 */
export function clearHeartbeatCache() {
  spaceCache.clear();
  relatedCache.clear();
}

/** 来源一：同 UP 投稿（很多音乐搬运号是单一曲风频道） */
async function fromSameUp(mid: number): Promise<SongCandidate[]> {
  const cached = spaceCache.get(mid);
  if (cached) return cached;

  let out: SongCandidate[] = [];
  try {
    const res = await getSpaceWbiArcSearch({ mid, ps: 30, pn: 1, order: "click" });
    if (res.code === 0) {
      out = (res.data?.list?.vlist ?? []).slice(0, PER_SEED_SPACE).map(v => ({
        bvid: v.bvid,
        title: v.title,
        durationSec: toSeconds(v.length),
        cover: v.pic,
        ownerMid: v.mid,
        ownerName: v.author,
        play: v.play,
      }));
    }
  } catch {
    out = [];
  }
  spaceCache.set(mid, out);
  return out;
}

/** 来源二：看了又看（B 站原生共看相似，跨 UP，多样性高） */
async function fromRelated(bvid: string): Promise<SongCandidate[]> {
  const cached = relatedCache.get(bvid);
  if (cached) return cached;

  let out: SongCandidate[] = [];
  try {
    const res = await getWebInterfaceArchiveRelated(bvid);
    if (res.code === 0) {
      out = (res.data ?? []).slice(0, PER_SEED_RELATED).map(r => ({
        bvid: r.bvid,
        title: r.title,
        durationSec: r.duration,
        cover: r.pic,
        ownerMid: r.owner?.mid,
        ownerName: r.owner?.name,
        tname: r.tname,
        play: r.stat?.view,
      }));
    }
  } catch {
    out = [];
  }
  relatedCache.set(bvid, out);
  return out;
}

/**
 * Stage 2：view 核验。剔除多 P（合集/整张专辑），用精确时长/子分区再过一次 Stage 1。
 * 只核验前 limit 个（分批并发，控制请求量），未核验的直接丢弃 —— 精度优先。
 */
async function verify(cands: SongCandidate[], limit: number): Promise<SongCandidate[]> {
  const head = cands.slice(0, limit);
  const out: SongCandidate[] = [];
  for (const batch of chunk(head, 6)) {
    const checked = await Promise.all(
      batch.map(async c => {
        try {
          const res = await getWebInterfaceView({ bvid: c.bvid });
          const d = res?.data;
          if (!d || res.code !== 0) return null;
          if ((d.videos ?? 1) > 1) return null; // 多 P → 合集/整张专辑，排除
          const merged: SongCandidate = {
            ...c,
            durationSec: d.duration || c.durationSec,
            tname: d.tname || c.tname,
          };
          return isPureSongCandidate(merged) ? merged : null;
        } catch {
          return null;
        }
      }),
    );
    out.push(...checked.filter((x): x is SongCandidate => x !== null));
  }
  return out;
}

/**
 * 从种子构建候选池：看了又看（优先，跨 UP）+ 同 UP → Stage 1 过滤 → 去重（bvid + 同名指纹 + 单 UP 限额）
 * →（可选）Stage 2 核验。
 */
export async function buildCandidatePool(seeds: Seed[], opts: BuildOptions): Promise<SongCandidate[]> {
  const picked = seeds.slice(0, opts.maxSeeds ?? MAX_SEEDS);

  // 看了又看优先（跨 UP、多样性高），同 UP 垫后（稳定但同系列高度重合）
  const relatedGroups = await Promise.all(picked.filter(s => s.bvid).map(s => fromRelated(s.bvid!)));
  const spaceGroups = await Promise.all(picked.filter(s => s.ownerMid).map(s => fromSameUp(s.ownerMid!)));

  const seenBvid = new Set<string>(opts.exclude);
  const seenKeys: string[] = [...(opts.excludeKeys ?? [])];
  const perUp = new Map<number, number>();
  const pool: SongCandidate[] = [];

  for (const g of [...relatedGroups, ...spaceGroups]) {
    for (const c of g) {
      if (!c.bvid || seenBvid.has(c.bvid)) continue;
      if (!isPureSongCandidate(c)) continue;
      const key = songKey(c.title);
      if (seenKeys.some(k => isSameSong(k, key))) continue; // 同名去重（不同 UP 传的同一首歌）
      const mid = c.ownerMid ?? -1;
      if ((perUp.get(mid) ?? 0) >= PER_UP_CAP) continue; // 单 UP 限额，防同系列刷屏
      seenBvid.add(c.bvid);
      seenKeys.push(key);
      perUp.set(mid, (perUp.get(mid) ?? 0) + 1);
      pool.push(c);
    }
  }

  return opts.doVerify ? verify(pool, VERIFY_LIMIT) : pool;
}
