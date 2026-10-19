import { randomUUID } from "node:crypto";
import path from "node:path";

import type { LyricLine } from "./lyrics.js";

import { AlignError } from "./errors.js";
import { listJson, readJson, writeJsonAtomic } from "./json-file.js";

// pending → approved / rejected；同一人对同一投稿再次提交时，旧的 pending 变 withdrawn；
// 新版本通过后，原来在用的那份变 superseded。只有 approved 的那份对所有人生效。
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

export interface Approved {
  bvid: string;
  cid: string;
  submissionId: string;
  lyricsHash: string;
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

  getApproved(bvid: string, cid: string) {
    return readJson<Approved>(this.approvedFile(bvid, cid));
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
      const approved = await this.getApproved(input.bvid, input.cid);
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
      const prev = await this.getApproved(sub.bvid, sub.cid);
      if (prev) {
        const old = await readJson<Submission>(this.file(prev.submissionId));
        if (old) await writeJsonAtomic(this.file(old.id), { ...old, status: "superseded" });
      }
      const now = Date.now();
      const done: Submission = { ...sub, status: "approved", reviewedAt: now, reviewedBy: reviewer };
      await writeJsonAtomic(this.file(id), done);
      await writeJsonAtomic(this.approvedFile(sub.bvid, sub.cid), {
        bvid: sub.bvid,
        cid: sub.cid,
        submissionId: id,
        lyricsHash: sub.lyricsHash,
        approvedAt: now,
      } satisfies Approved);
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
