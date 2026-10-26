import path from "node:path";

import { readJson, writeJsonAtomic } from "./json-file.js";

// 客户端能上报的来源；screen / subtitle 只由服务端的画面识别任务写入，客户端不能冒充
export const RECOGNIZED_FROM = ["netease", "lrclib", "qq", "kugou", "amll"] as const;
export type RecognizedFrom = (typeof RECOGNIZED_FROM)[number] | "screen" | "subtitle";

// 「查无歌词」只记几天：之后曲库可能收录了，也可能是上报那位用户的渠道恰好都失败了，不能永久占住这首歌
export const MISSING_TTL_MS = 3 * 24 * 60 * 60_000;

// 客户端自动识别出的歌词（还没对齐、也不一定对齐得上），或「五个渠道都查过、确实没有」的标记，二选一。
// v 是客户端自动匹配算法的版本：算法升级后旧结果不再被采用，新版本可以覆盖旧版本
export interface RecognizedRecord {
  bvid: string;
  cid: string;
  v: number;
  lyrics?: string;
  tLyrics?: string;
  from?: RecognizedFrom;
  // 只对 screen 有意义：画面文字和字幕读音的吻合度够高。不够高时客户端提示「可能有错字」
  confident?: boolean;
  missingUntil?: number;
  by: string;
  at: number;
}

export type RecognizedInput =
  | {
      bvid: string;
      cid: string;
      v: number;
      by: string;
      lyrics: string;
      tLyrics?: string;
      from: RecognizedFrom;
      confident?: boolean;
    }
  | { bvid: string; cid: string; v: number; by: string; missing: true };

// 同 SubmissionStore：单进程内串行化读-改-写，避免两位用户同时上报时互相覆盖
export class RecognizedStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dataDir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private file(bvid: string, cid: string) {
    return path.join(this.dataDir, "recognized", `${bvid}_${cid}.json`);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // 对外只给客户端需要的字段，不带上报者 mid
  async get(bvid: string, cid: string) {
    const rec = await readJson<RecognizedRecord>(this.file(bvid, cid));
    if (!rec) return { recognized: null, missingUntil: null, v: null };
    if (rec.lyrics) {
      return {
        recognized: {
          lyrics: rec.lyrics,
          tLyrics: rec.tLyrics ?? null,
          from: rec.from!,
          ...(rec.confident !== undefined ? { confident: rec.confident } : {}),
        },
        missingUntil: null,
        v: rec.v,
      };
    }
    const alive = rec.missingUntil !== undefined && rec.missingUntil > this.now();
    return { recognized: null, missingUntil: alive ? rec.missingUntil! : null, v: alive ? rec.v : null };
  }

  // 有歌词的记录比「查无」强，同版本先到先得；更高版本的算法可以覆盖旧结果
  put(input: RecognizedInput): Promise<boolean> {
    return this.serial(async () => {
      const file = this.file(input.bvid, input.cid);
      const cur = await readJson<RecognizedRecord>(file);
      if ("missing" in input) {
        if (cur?.lyrics) return false;
        if (cur?.missingUntil && cur.missingUntil > this.now() && cur.v >= input.v) return false;
        await writeJsonAtomic(file, {
          bvid: input.bvid,
          cid: input.cid,
          v: input.v,
          missingUntil: this.now() + MISSING_TTL_MS,
          by: input.by,
          at: this.now(),
        } satisfies RecognizedRecord);
        return true;
      }
      if (cur?.lyrics && cur.v >= input.v) return false;
      await writeJsonAtomic(file, {
        bvid: input.bvid,
        cid: input.cid,
        v: input.v,
        lyrics: input.lyrics,
        tLyrics: input.tLyrics,
        from: input.from,
        confident: input.confident,
        by: input.by,
        at: this.now(),
      } satisfies RecognizedRecord);
      return true;
    });
  }
}
