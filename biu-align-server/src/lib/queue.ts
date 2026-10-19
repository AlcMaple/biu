import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { AlignmentCache } from "./alignment-cache.js";
import type { downloadAudio, getVideoPage } from "./bilibili.js";
import type { LyricLine } from "./lyrics.js";
import type { RunWorker } from "./worker.js";

import { AlignError } from "./errors.js";
import { type Alignment, buildAlignment, looksMismatched } from "./result.js";

type JobState = "queued" | "running" | "done" | "failed";

interface Job {
  id: string;
  key: string;
  mid: string;
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
}

export interface QueueDeps {
  cache: AlignmentCache;
  runWorker: RunWorker;
  getVideoPage: typeof getVideoPage;
  downloadAudio: typeof downloadAudio;
  workDir: string;
  queueMax: number;
  dailyQuota: number;
  isAdmin: (mid: string) => boolean;
}

const FINISHED_JOB_TTL_MS = 60 * 60_000;

// 单并发：对齐吃满 CPU（Demucs 1.5 min + MMS 40 s），两首同时跑只会都变慢，还可能把这台机上的其他服务挤掉。
// 任务只放内存：重启后客户端查不到会得到 JOB_NOT_FOUND 并提示重新提交；已完成的结果在磁盘缓存里，不会白算。
export class AlignQueue {
  private jobs = new Map<string, Job>();
  private waiting: Job[] = [];
  private running?: Job;
  private quota = new Map<string, { day: string; used: number }>();

  constructor(private readonly deps: QueueDeps) {}

  async submit(input: {
    mid: string;
    bvid: string;
    cid: string;
    lyricsHash: string;
    lines: LyricLine[];
  }): Promise<JobView> {
    const { cache } = this.deps;
    const key = cacheKey(input);
    const cached = await cache.get(key);
    if (cached) return { id: null, state: "done", alignment: cached };

    const same = [...this.jobs.values()].find(j => j.key === key && (j.state === "queued" || j.state === "running"));
    if (same) return this.view(same);
    const busy = [...this.jobs.values()].find(
      j => j.mid === input.mid && (j.state === "queued" || j.state === "running"),
    );
    if (busy) throw new AlignError("JOB_BUSY");
    if (this.waiting.length >= this.deps.queueMax) throw new AlignError("QUEUE_FULL");
    this.charge(input.mid);

    const job: Job = { ...input, id: randomUUID(), key, state: "queued", createdAt: Date.now() };
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

  private view(job: Job): JobView {
    return {
      id: job.id,
      state: job.state,
      ...(job.stage && job.state === "running" ? { stage: job.stage } : {}),
      ...(job.state === "queued"
        ? { position: this.waiting.indexOf(job) + 1 }
        : job.state === "running"
          ? { position: 0 }
          : {}),
      ...(job.error ? { error: job.error.toJSON() } : {}),
      ...(job.alignment ? { alignment: job.alignment } : {}),
    };
  }

  private charge(mid: string) {
    if (this.deps.isAdmin(mid)) return;
    const day = new Date().toLocaleDateString("sv-SE");
    const q = this.quota.get(mid);
    const used = q?.day === day ? q.used : 0;
    if (used >= this.deps.dailyQuota) throw new AlignError("QUOTA_EXCEEDED");
    this.quota.set(mid, { day, used: used + 1 });
  }

  // 服务器自己的问题（B 站限流、下载失败、崩溃）不该扣用户当天的次数；歌词对不上这类用户侧原因照扣
  private refund(mid: string) {
    const q = this.quota.get(mid);
    if (q && q.used > 0) q.used--;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const job = this.waiting.shift();
    if (!job) return;
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
      await this.deps.cache.put(job.key, alignment);
      job.alignment = alignment;
      job.state = "done";
    } catch (err) {
      job.error = err instanceof AlignError ? err : new AlignError("ALIGN_FAILED", String(err));
      job.state = "failed";
      if (job.error.status >= 500) this.refund(job.mid);
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

export const cacheKey = (t: { bvid: string; cid: string; lyricsHash: string }) => `${t.bvid}/${t.cid}/${t.lyricsHash}`;
