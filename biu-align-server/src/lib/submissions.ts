import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import type { LyricLine } from "./lyrics.js";

import { AlignError } from "./errors.js";
import { listJson, readJson, writeJsonAtomic } from "./json-file.js";

// pending → approved / rejected；同一人对同一投稿再次提交时，旧的 pending 变 withdrawn；
// 新版本通过后，原来在用的那份变 superseded。生效版本（Published）也可能来自自动对齐或管理员发布，不一定对应一条提交。
export type SubmissionStatus = "pending" | "approved" | "rejected" | "withdrawn" | "superseded";

export interface Submission {
  id: string;
  bvid: string;
  cid: string;
  mid: string;
  lyricsHash: string;
  lines: LyricLine[];
  title: string;
  status: SubmissionStatus;
  note?: string;
  reason?: string;
  createdAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
}

// 一首歌当前对所有人生效的版本。来源：auto = 第一位听众播放时自动对齐成功；upload = 用户上传、审核通过；
// admin = 管理员手动对齐后直接发布。文件名沿用 approved/，已部署的数据不用迁移（旧记录没有 source，按 upload 理解）
export type PublishSource = "auto" | "upload" | "admin";

export interface Published {
  bvid: string;
  cid: string;
  lyricsHash: string;
  source?: PublishSource;
  submissionId?: string;
  by?: string;
  approvedAt: number;
}

// 单进程内串行化所有写操作：审核和提交可能同时发生，读-改-写交错会丢状态（同 biu-sync-server 的单进程约束）
export class SubmissionStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  private dir() {
    return path.join(this.dataDir, "submissions");
  }

  private file(id: string) {
    return path.join(this.dir(), `${id}.json`);
  }

  private approvedFile(bvid: string, cid: string) {
    return path.join(this.dataDir, "approved", `${bvid}_${cid}.json`);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  getPublished(bvid: string, cid: string) {
    return readJson<Published>(this.approvedFile(bvid, cid));
  }

  // 已有版本时不覆盖：自动对齐只填空白，不和上传 / 管理员的版本抢
  publishIfEmpty(input: Omit<Published, "approvedAt">): Promise<boolean> {
    return this.serial(async () => {
      if (await this.getPublished(input.bvid, input.cid)) return false;
      await this.writePublished(input);
      return true;
    });
  }

  publish(input: Omit<Published, "approvedAt">): Promise<void> {
    return this.serial(() => this.replacePublished(input));
  }

  // 只下线指定的那份：报错提交后、处理前，这首歌可能已经换了新版本，不能误删新版本
  unpublish(bvid: string, cid: string, lyricsHash: string): Promise<boolean> {
    return this.serial(async () => {
      const cur = await this.getPublished(bvid, cid);
      if (cur?.lyricsHash !== lyricsHash) return false;
      await this.markSuperseded(cur);
      await rm(this.approvedFile(bvid, cid), { force: true });
      return true;
    });
  }

  private async markSuperseded(prev: Published | undefined) {
    if (!prev?.submissionId) return;
    const old = await readJson<Submission>(this.file(prev.submissionId));
    if (old) await writeJsonAtomic(this.file(old.id), { ...old, status: "superseded" });
  }

  private writePublished(input: Omit<Published, "approvedAt">) {
    return writeJsonAtomic(this.approvedFile(input.bvid, input.cid), {
      ...input,
      approvedAt: Date.now(),
    } satisfies Published);
  }

  private async replacePublished(input: Omit<Published, "approvedAt">) {
    await this.markSuperseded(await this.getPublished(input.bvid, input.cid));
    await this.writePublished(input);
  }

  async get(id: string): Promise<Submission> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new AlignError("SUBMISSION_NOT_FOUND");
    const s = await readJson<Submission>(this.file(id));
    if (!s) throw new AlignError("SUBMISSION_NOT_FOUND");
    return s;
  }

  async list(filter: (s: Submission) => boolean): Promise<Submission[]> {
    return (await listJson<Submission>(this.dir())).filter(filter).sort((a, b) => b.createdAt - a.createdAt);
  }

  create(
    input: Pick<Submission, "bvid" | "cid" | "mid" | "lyricsHash" | "lines" | "title" | "note">,
  ): Promise<Submission> {
    return this.serial(async () => {
      const approved = await this.getPublished(input.bvid, input.cid);
      if (approved?.lyricsHash === input.lyricsHash) throw new AlignError("ALREADY_APPROVED");
      const mine = await this.list(
        s => s.mid === input.mid && s.bvid === input.bvid && s.cid === input.cid && s.status === "pending",
      );
      for (const old of mine) await writeJsonAtomic(this.file(old.id), { ...old, status: "withdrawn" });
      const sub: Submission = { ...input, id: randomUUID(), status: "pending", createdAt: Date.now() };
      await writeJsonAtomic(this.file(sub.id), sub);
      return sub;
    });
  }

  approve(id: string, reviewer: string): Promise<Submission> {
    return this.serial(async () => {
      const sub = await this.get(id);
      if (sub.status !== "pending") throw new AlignError("SUBMISSION_NOT_PENDING");
      await this.replacePublished({
        bvid: sub.bvid,
        cid: sub.cid,
        lyricsHash: sub.lyricsHash,
        source: "upload",
        submissionId: id,
        by: reviewer,
      });
      const done: Submission = { ...sub, status: "approved", reviewedAt: Date.now(), reviewedBy: reviewer };
      await writeJsonAtomic(this.file(id), done);
      return done;
    });
  }

  reject(id: string, reviewer: string, reason: string): Promise<Submission> {
    return this.serial(async () => {
      const sub = await this.get(id);
      if (sub.status !== "pending") throw new AlignError("SUBMISSION_NOT_PENDING");
      const done: Submission = { ...sub, status: "rejected", reason, reviewedAt: Date.now(), reviewedBy: reviewer };
      await writeJsonAtomic(this.file(id), done);
      return done;
    });
  }
}
