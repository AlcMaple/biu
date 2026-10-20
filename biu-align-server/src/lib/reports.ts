import { randomUUID } from "node:crypto";
import path from "node:path";

import { AlignError } from "./errors.js";
import { listJson, readJson, writeJsonAtomic } from "./json-file.js";

// pending → resolved（管理员确认有误，可同时下线那份时间轴）/ dismissed（没发现问题，写原因给报错人看）。
// 同一人对同一首歌的同一份时间轴重复报错，只更新说明，不堆新条目
export type ReportStatus = "pending" | "resolved" | "dismissed";

export interface Report {
  id: string;
  bvid: string;
  cid: string;
  mid: string;
  // 报错人当时看到的那份；管理员据此取对齐结果试听，也据此只下线这一份
  lyricsHash: string;
  title: string;
  note: string;
  // 报错时那份是不是对所有人生效的版本；不是的话说明报错人自己换过歌词，下线无从谈起
  wasPublished: boolean;
  status: ReportStatus;
  reason?: string;
  withdrawn?: boolean;
  createdAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
}

// 单进程内串行化写操作，理由同 SubmissionStore
export class ReportStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  private dir() {
    return path.join(this.dataDir, "reports");
  }

  private file(id: string) {
    return path.join(this.dir(), `${id}.json`);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  async get(id: string): Promise<Report> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new AlignError("REPORT_NOT_FOUND");
    const r = await readJson<Report>(this.file(id));
    if (!r) throw new AlignError("REPORT_NOT_FOUND");
    return r;
  }

  async list(filter: (r: Report) => boolean): Promise<Report[]> {
    return (await listJson<Report>(this.dir())).filter(filter).sort((a, b) => b.createdAt - a.createdAt);
  }

  create(input: Pick<Report, "bvid" | "cid" | "mid" | "lyricsHash" | "title" | "note" | "wasPublished">) {
    return this.serial(async () => {
      const [dup] = await this.list(
        r =>
          r.mid === input.mid &&
          r.bvid === input.bvid &&
          r.cid === input.cid &&
          r.lyricsHash === input.lyricsHash &&
          r.status === "pending",
      );
      const report: Report = dup
        ? { ...dup, note: input.note, createdAt: Date.now() }
        : { ...input, id: randomUUID(), status: "pending", createdAt: Date.now() };
      await writeJsonAtomic(this.file(report.id), report);
      return report;
    });
  }

  close(
    id: string,
    reviewer: string,
    result: { status: "resolved" | "dismissed"; reason?: string; withdrawn?: boolean },
  ): Promise<Report> {
    return this.serial(async () => {
      const r = await this.get(id);
      if (r.status !== "pending") throw new AlignError("REPORT_NOT_PENDING");
      const done: Report = { ...r, ...result, reviewedAt: Date.now(), reviewedBy: reviewer };
      await writeJsonAtomic(this.file(id), done);
      return done;
    });
  }
}
