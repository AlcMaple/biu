import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { AlignmentCache, FailureCache } from "./alignment-cache.js";
import type { downloadAudio, getVideoPage } from "./bilibili.js";
import type { DraftStore, InputStore } from "./drafts.js";
import type { LyricLine } from "./lyrics.js";
import type { RunWorker } from "./worker.js";

import { AlignError, type AlignErrorCode } from "./errors.js";
import { type Alignment, buildAlignment, looksMismatched } from "./result.js";

type JobState = "queued" | "running" | "done" | "failed";

// auto = 客户端播到一首歌时自动发起；upload = 用户上传歌词后服务端代为对齐，供审核员预览；
// manual = 管理员手动对齐，用来判断是算法错了还是别的原因，插到队首
export type JobOrigin = "auto" | "upload" | "manual";

interface Job {
  id: string;
  key: string;
  mid: string;
  origin: JobOrigin;
  bvid: string;
  cid: string;
  lyricsHash: string;
  lines: LyricLine[];
  state: JobState;
  stage?: "download" | "align";
  error?: AlignError;
  alignment?: Alignment;
  createdAt: number;
  finishedAt?: number;
}

export interface JobView {
  // 命中缓存时没有任务，客户端不必轮询
  id: string | null;
  state: JobState;
  stage?: Job["stage"];
  // 前面还有几个任务；0 = 正在跑
  position?: number;
  error?: { code: string; message: string };
  alignment?: Alignment;
  // 管理员手动对齐的结果：还没发布，所有人在用的仍是原来那份
  draft?: true;
}

export interface QueueDeps {
  cache: AlignmentCache;
  failures: FailureCache;
  drafts: DraftStore;
  inputs: InputStore;
  runWorker: RunWorker;
  getVideoPage: typeof getVideoPage;
  downloadAudio: typeof downloadAudio;
  workDir: string;
  // 对齐成功后的处理（自动对齐的结果直接对所有人生效）；出错只记日志，不影响任务本身已成功
  onAligned?: (job: { origin: JobOrigin; bvid: string; cid: string; lyricsHash: string }) => Promise<void>;
}

const FINISHED_JOB_TTL_MS = 60 * 60_000;

// 这些失败换谁来、什么时候来都一样，记下来，后面的听众不再白跑 2 min；服务器侧原因（限流、下载失败、崩溃）不记
const STICKY_FAILURES = new Set<AlignErrorCode>(["LYRICS_MISMATCH", "AUDIO_TOO_SHORT", "VIDEO_TOO_LONG"]);

const isActive = (j: Job) => j.state === "queued" || j.state === "running";

// 单并发：对齐吃满 CPU（Demucs 1.5 min + MMS 40 s），两首同时跑只会都变慢，还可能把这台机上的其他服务挤掉。
// 不设排队上限、不限每人每天次数：用户是来听歌的，自动对齐是为了下次再听时有逐字歌词，排得慢只是部署方多花算力。
// 但一个人连切几十首会排进几十个任务，所以出队不是先来先到：管理员手动的最先；其余按人轮转，每人取他最近点的那首
// （正在听的那首最有用），切歌狂人只占自己那一份，不会把别人挤到一小时后。
// 任务只放内存：重启后客户端查不到会得到 JOB_NOT_FOUND；已完成的结果在磁盘缓存里，不会白算。
export class AlignQueue {
  private jobs = new Map<string, Job>();
  private waiting: Job[] = [];
  private running?: Job;
  // mid → 上次轮到他的时刻；越久没轮到越先
  private lastServed = new Map<string, number>();

  constructor(private readonly deps: QueueDeps) {}

  async submit(input: {
    mid: string;
    origin: JobOrigin;
    bvid: string;
    cid: string;
    lyricsHash: string;
    lines: LyricLine[];
    // 只对 manual 有意义：已有草稿也重跑
    force?: boolean;
  }): Promise<JobView> {
    const { cache, failures, drafts } = this.deps;
    const { force, ...rest } = input;
    const key = cacheKey(input);
    const manual = input.origin === "manual";

    // 管理员手动对齐跳过成功和失败两种缓存（为了重跑一遍看结果）；但上次重跑过、还没发布的草稿直接给回去，
    // 否则管理员切歌回来、或在审核页和播放器之间来回，每次都要白等 2 分钟
    if (manual && !force) {
      const draft = await drafts.get(input);
      if (draft) return { id: null, state: "done", alignment: draft.alignment, draft: true };
    }
    if (!manual) {
      const failed = await failures.get(key);
      if (failed) return { id: null, state: "failed", error: new AlignError(failed.code).toJSON() };
      const cached = await cache.get(key);
      if (cached) return { id: null, state: "done", alignment: cached };
    }

    // 手动和非手动的结果写到不同地方（草稿 / 对齐缓存），不能互相合并
    const same = [...this.jobs.values()].find(j => j.key === key && isActive(j) && (j.origin === "manual") === manual);
    if (same) return this.view(same);

    const job: Job = { ...rest, id: randomUUID(), key, state: "queued", createdAt: Date.now() };
    this.jobs.set(job.id, job);
    this.waiting.push(job);
    void this.pump();
    return this.view(job);
  }

  get(id: string): JobView {
    const job = this.jobs.get(id);
    if (!job) throw new AlignError("JOB_NOT_FOUND");
    return this.view(job);
  }

  // 按出队规则排出的完整顺序；排队的人看到的 position 和实际轮到的时刻一致
  private order(): Job[] {
    const manual = this.waiting.filter(j => j.origin === "manual");
    return [
      ...manual,
      ...fairOrder(
        this.waiting.filter(j => j.origin !== "manual"),
        this.lastServed,
      ),
    ];
  }

  private view(job: Job): JobView {
    return {
      id: job.id,
      state: job.state,
      ...(job.stage && job.state === "running" ? { stage: job.stage } : {}),
      ...(job.state === "queued"
        ? { position: this.order().indexOf(job) + 1 }
        : job.state === "running"
          ? { position: 0 }
          : {}),
      ...(job.error ? { error: job.error.toJSON() } : {}),
      ...(job.alignment ? { alignment: job.alignment } : {}),
      ...(job.alignment && job.origin === "manual" ? { draft: true as const } : {}),
    };
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const job = this.order()[0];
    if (!job) return;
    this.waiting.splice(this.waiting.indexOf(job), 1);
    if (job.origin !== "manual") this.lastServed.set(job.mid, Date.now());
    this.running = job;
    job.state = "running";
    const dir = path.join(this.deps.workDir, job.id);
    try {
      await mkdir(dir, { recursive: true });
      job.stage = "download";
      const page = await this.deps.getVideoPage(job.bvid, job.cid);
      const audio = path.join(dir, "audio.m4a");
      await this.deps.downloadAudio(page, audio);
      job.stage = "align";
      const out = await this.deps.runWorker(audio, job.lines, dir);
      const alignment = buildAlignment(job, page, job.lines, out);
      if (
        looksMismatched(
          alignment,
          job.lines.some(l => l.t > 0),
        )
      )
        throw new AlignError("LYRICS_MISMATCH");
      if (job.origin === "manual") {
        await this.deps.drafts.put({
          bvid: job.bvid,
          cid: job.cid,
          lyricsHash: job.lyricsHash,
          alignment,
          by: job.mid,
          createdAt: Date.now(),
        });
      } else {
        await this.deps.cache.put(job.key, alignment);
      }
      await this.deps.inputs.put(job.key, job.lines).catch(err => console.error(`[job ${job.id}] 保存原歌词失败`, err));
      job.alignment = alignment;
      job.state = "done";
      await this.deps.onAligned?.(job).catch(err => console.error(`[job ${job.id}] 对齐后处理失败`, err));
    } catch (err) {
      job.error = err instanceof AlignError ? err : new AlignError("ALIGN_FAILED", String(err));
      job.state = "failed";
      // 手动重跑的失败不记：它和成功结果一样只是给管理员看的，不该改变其他听众自动对齐时拿到的结果
      if (job.origin !== "manual" && STICKY_FAILURES.has(job.error.code)) {
        await this.deps.failures
          .put(job.key, job.error.code)
          .catch(e => console.error(`[job ${job.id}] 记录失败结果出错`, e));
      }
      console.error(`[job ${job.id}] ${job.bvid}/${job.cid} ${job.error.code}: ${job.error.message}`);
    } finally {
      job.finishedAt = Date.now();
      job.lines = [];
      this.running = undefined;
      await rm(dir, { recursive: true, force: true }).catch(err =>
        console.error(`[job ${job.id}] 清理工作目录失败`, err),
      );
      setTimeout(() => this.jobs.delete(job.id), FINISHED_JOB_TTL_MS).unref();
      void this.pump();
    }
  }
}

// 按人轮转：越久没轮到的人越先，每人先跑他最近点的那首（正在听的那首最有用）。lastServed：mid → 上次轮到他的时刻
export function fairOrder<T extends { mid: string; createdAt: number }>(
  waiting: T[],
  lastServed: Map<string, number>,
): T[] {
  const byMid = new Map<string, T[]>();
  for (const j of waiting) byMid.set(j.mid, [...(byMid.get(j.mid) ?? []), j]);
  for (const list of byMid.values()) list.sort((a, b) => b.createdAt - a.createdAt);
  const mids = [...byMid.keys()].sort((a, b) => (lastServed.get(a) ?? 0) - (lastServed.get(b) ?? 0));
  const out: T[] = [];
  for (let round = 0; out.length < waiting.length; round++) {
    for (const mid of mids) {
      const j = byMid.get(mid)![round];
      if (j) out.push(j);
    }
  }
  return out;
}

export const cacheKey = (t: { bvid: string; cid: string; lyricsHash: string }) => `${t.bvid}/${t.cid}/${t.lyricsHash}`;
