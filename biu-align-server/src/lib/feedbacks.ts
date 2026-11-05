import { randomUUID } from "node:crypto";
import path from "node:path";

import { AlignError } from "./errors.js";
import { listJson, readJson, writeJsonAtomic } from "./json-file.js";

export const FEEDBACK_KINDS = ["bug", "feature"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface Feedback {
  id: string;
  mid: string;
  kind: FeedbackKind;
  content: string;
  appVersion: string;
  platform: string;
  status: "pending" | "done";
  reply?: string;
  createdAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
}

// 单进程内串行化写操作，理由同 ReportStore
export class FeedbackStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  private dir() {
    return path.join(this.dataDir, "feedbacks");
  }

  private file(id: string) {
    return path.join(this.dir(), `${id}.json`);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  async get(id: string): Promise<Feedback> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new AlignError("FEEDBACK_NOT_FOUND");
    const f = await readJson<Feedback>(this.file(id));
    if (!f) throw new AlignError("FEEDBACK_NOT_FOUND");
    return f;
  }

  async list(filter: (f: Feedback) => boolean): Promise<Feedback[]> {
    return (await listJson<Feedback>(this.dir())).filter(filter).sort((a, b) => b.createdAt - a.createdAt);
  }

  create(input: Pick<Feedback, "mid" | "kind" | "content" | "appVersion" | "platform">) {
    return this.serial(async () => {
      const feedback: Feedback = { ...input, id: randomUUID(), status: "pending", createdAt: Date.now() };
      await writeJsonAtomic(this.file(feedback.id), feedback);
      return feedback;
    });
  }

  close(id: string, reviewer: string, reply?: string) {
    return this.serial(async () => {
      const f = await this.get(id);
      if (f.status !== "pending") throw new AlignError("FEEDBACK_NOT_PENDING");
      const done: Feedback = {
        ...f,
        status: "done",
        ...(reply ? { reply } : {}),
        reviewedAt: Date.now(),
        reviewedBy: reviewer,
      };
      await writeJsonAtomic(this.file(id), done);
      return done;
    });
  }
}
