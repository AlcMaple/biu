import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { downloadVideo, getVideoPage } from "./bilibili.js";
import type { LyricLine } from "./lyrics.js";
import type { RecognizedStore } from "./recognized.js";
import type { RunScreen, SubtitleLine } from "./screen-worker.js";

import { AlignError } from "./errors.js";
import { fairOrder } from "./queue.js";

type JobState = "queued" | "running" | "done" | "failed";

interface ScreenJob {
  id: string;
  key: string;
  mid: string;
  bvid: string;
  cid: string;
  v: number;
  subtitle: SubtitleLine[];
  state: JobState;
  stage?: "download" | "recognize";
  error?: AlignError;
  createdAt: number;
}

// 结果不随任务返回：写进「已识别歌词」，客户端完成后照常去那里读，和别人识别出的结果走同一条路
export interface ScreenJobView {
  id: string | null;
  state: JobState;
  stage?: ScreenJob["stage"];
  position?: number;
  error?: { code: string; message: string };
}

export interface ScreenQueueDeps {
  recognized: RecognizedStore;
  runScreen: RunScreen;
  getVideoPage: typeof getVideoPage;
  downloadVideo: typeof downloadVideo;
  workDir: string;
}

const FINISHED_JOB_TTL_MS = 60 * 60_000;
// 和服务端「至少 3 行带时间才算识别成功」的门槛一致
const MIN_LINES = 3;

const isActive = (j: ScreenJob) => j.state === "queued" || j.state === "running";

const lrcTime = (t: number) => {
  const cs = Math.round(t * 100);
  const mm = String(Math.floor(cs / 6000)).padStart(2, "0");
  const ss = String(Math.floor((cs % 6000) / 100)).padStart(2, "0");
  return `[${mm}:${ss}.${String(cs % 100).padStart(2, "0")}]`;
};

export const toLrc = (lines: LyricLine[]) => lines.map(l => `${lrcTime(l.t)}${l.text}`).join("\n");

// 和对齐队列分开排：识别画面只占约 150 MB、半分钟，和对齐（峰值近 4 GB）并行不会挤爆内存，
// 排在一条队里反而要等前面的对齐跑完。同样单并发、按人轮转（见 AlignQueue）。
// 同一个视频只排一次：结果对所有人共享，第二个人提交时直接拿到正在跑的那个任务
export class ScreenQueue {
  private jobs = new Map<string, ScreenJob>();
  private waiting: ScreenJob[] = [];
  private running?: ScreenJob;
  private lastServed = new Map<string, number>();

  constructor(private readonly deps: ScreenQueueDeps) {}

  async submit(input: {
    mid: string;
    bvid: string;
    cid: string;
    v: number;
    subtitle: SubtitleLine[];
  }): Promise<ScreenJobView> {
    const key = `${input.bvid}/${input.cid}`;
    const cur = await this.deps.recognized.get(input.bvid, input.cid);
    if (cur.v !== null && cur.v >= input.v && (cur.recognized || cur.missingUntil)) return { id: null, state: "done" };

    const same = [...this.jobs.values()].find(j => j.key === key && isActive(j));
    if (same) return this.view(same);

    const job: ScreenJob = { ...input, id: randomUUID(), key, state: "queued", createdAt: Date.now() };
    this.jobs.set(job.id, job);
    this.waiting.push(job);
    void this.pump();
    return this.view(job);
  }

  get(id: string): ScreenJobView {
    const job = this.jobs.get(id);
    if (!job) throw new AlignError("JOB_NOT_FOUND");
    return this.view(job);
  }

  private view(job: ScreenJob): ScreenJobView {
    return {
      id: job.id,
      state: job.state,
      ...(job.stage && job.state === "running" ? { stage: job.stage } : {}),
      ...(job.state === "queued"
        ? { position: fairOrder(this.waiting, this.lastServed).indexOf(job) + 1 }
        : job.state === "running"
          ? { position: 0 }
          : {}),
      ...(job.error ? { error: job.error.toJSON() } : {}),
    };
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const job = fairOrder(this.waiting, this.lastServed)[0];
    if (!job) return;
    this.waiting.splice(this.waiting.indexOf(job), 1);
    this.lastServed.set(job.mid, Date.now());
    this.running = job;
    job.state = "running";
    const dir = path.join(this.deps.workDir, `screen-${job.id}`);
    try {
      await mkdir(dir, { recursive: true });
      job.stage = "download";
      const page = await this.deps.getVideoPage(job.bvid, job.cid);
      // B 站 DASH 视频分段改叫 .mp4，AVFoundation 就能直接读
      const video = path.join(dir, "video.mp4");
      await this.deps.downloadVideo(page, video);
      job.stage = "recognize";
      const out = await this.deps.runScreen(video, job.subtitle, dir);
      const base = { bvid: job.bvid, cid: job.cid, v: job.v, by: job.mid };
      if (out.from && out.lines.length >= MIN_LINES) {
        await this.deps.recognized.put({ ...base, lyrics: toLrc(out.lines), from: out.from, confident: out.confident });
      } else {
        await this.deps.recognized.put({ ...base, missing: true });
      }
      job.state = "done";
    } catch (err) {
      job.error = err instanceof AlignError ? err : new AlignError("SCREEN_FAILED", String(err));
      job.state = "failed";
      console.error(`[screen ${job.id}] ${job.bvid}/${job.cid} ${job.error.code}: ${job.error.message}`);
    } finally {
      job.subtitle = [];
      this.running = undefined;
      await rm(dir, { recursive: true, force: true }).catch(err =>
        console.error(`[screen ${job.id}] 清理工作目录失败`, err),
      );
      setTimeout(() => this.jobs.delete(job.id), FINISHED_JOB_TTL_MS).unref();
      void this.pump();
    }
  }
}
