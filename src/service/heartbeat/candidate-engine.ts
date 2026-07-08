import { chunk } from "es-toolkit/array";

import { MAX_SEEDS, PER_SEED_RELATED, PER_SEED_SPACE, VERIFY_LIMIT } from "@/common/constants/heartbeat";
import { isPureSongCandidate, toSeconds, type SongCandidate } from "@/common/utils/pure-song";
import { getSpaceWbiArcSearch } from "@/service/space-wbi-arc-search";
import { getWebInterfaceArchiveRelated } from "@/service/web-interface-archive-related";
import { getWebInterfaceView } from "@/service/web-interface-view";

/** 一个种子：来自红心歌单里的一首歌 */
export interface Seed {
  bvid?: string;
  ownerMid?: number;
}

export interface BuildOptions {
  /** 排除这些 bvid（红心歌单里已有的 / 已服务过的） */
  exclude: Set<string>;
  /** 用作候选来源的种子数量上限 */
  maxSeeds?: number;
  /** 是否做 Stage 2 view 核验（剔除多 P/合集、用精确字段复筛） */
  doVerify?: boolean;
}

/** 来源一：同 UP 投稿（很多音乐搬运号是单一曲风频道） */
async function fromSameUp(mid: number): Promise<SongCandidate[]> {
  try {
    const res = await getSpaceWbiArcSearch({ mid, ps: 30, pn: 1, order: "click" });
    if (res.code !== 0) return [];
    return (res.data?.list?.vlist ?? []).slice(0, PER_SEED_SPACE).map(v => ({
      bvid: v.bvid,
      title: v.title,
      durationSec: toSeconds(v.length),
      cover: v.pic,
      ownerMid: v.mid,
      ownerName: v.author,
      play: v.play,
    }));
  } catch {
    return [];
  }
}

/** 来源二：看了又看（B 站原生共看相似） */
async function fromRelated(bvid: string): Promise<SongCandidate[]> {
  try {
    const res = await getWebInterfaceArchiveRelated(bvid);
    if (res.code !== 0) return [];
    return (res.data ?? []).slice(0, PER_SEED_RELATED).map(r => ({
      bvid: r.bvid,
      title: r.title,
      durationSec: r.duration,
      cover: r.pic,
      ownerMid: r.owner?.mid,
      ownerName: r.owner?.name,
      tname: r.tname,
      play: r.stat?.view,
    }));
  } catch {
    return [];
  }
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
 * 从种子构建候选池：同 UP + 看了又看 → Stage 1 过滤 → 去重 → （可选）Stage 2 核验。
 */
export async function buildCandidatePool(seeds: Seed[], opts: BuildOptions): Promise<SongCandidate[]> {
  const picked = seeds.slice(0, opts.maxSeeds ?? MAX_SEEDS);

  const groups = await Promise.all(
    picked.flatMap(s => {
      const tasks: Promise<SongCandidate[]>[] = [];
      if (s.ownerMid) tasks.push(fromSameUp(s.ownerMid));
      if (s.bvid) tasks.push(fromRelated(s.bvid));
      return tasks;
    }),
  );

  const seen = new Set<string>(opts.exclude);
  const pool: SongCandidate[] = [];
  for (const g of groups) {
    for (const c of g) {
      if (!c.bvid || seen.has(c.bvid)) continue;
      if (!isPureSongCandidate(c)) continue;
      seen.add(c.bvid);
      pool.push(c);
    }
  }

  return opts.doVerify ? verify(pool, VERIFY_LIMIT) : pool;
}
