import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * 网页端日志的落盘与清理。
 *
 * 按天一个 NDJSON 文件（`web-client-YYYY-MM-DD.log`），这样「轮转」就是天然的，
 * 不需要在写入时切文件。清理有两道闸：超过保留天数的直接删；总体积仍超上限时
 * 从最旧的文件继续删。两者都是为了防止长期运行把磁盘写爆。
 */

export const DEFAULT_CLIENT_LOG_RETENTION_DAYS = 7;
export const DEFAULT_CLIENT_LOG_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
/** 清理是纯 IO，没必要每次写都做一遍 */
const DEFAULT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

const FILE_PREFIX = "web-client-";
const FILE_SUFFIX = ".log";
const FILE_PATTERN = /^web-client-\d{4}-\d{2}-\d{2}\.log$/;

export interface ClientLogStoreOptions {
  dir: string;
  maxTotalBytes?: number;
  now?: () => number;
  pruneIntervalMs?: number;
  retentionDays?: number;
}

const dayKey = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

export class ClientLogStore {
  private lastPrunedAt = 0;
  private readonly maxTotalBytes: number;
  private readonly now: () => number;
  private readonly pruneIntervalMs: number;
  private readonly retentionDays: number;
  /** 串行化写入：并发 append 到同一个文件可能交错出半行 JSON */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: ClientLogStoreOptions) {
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_CLIENT_LOG_MAX_TOTAL_BYTES;
    this.now = options.now ?? Date.now;
    this.pruneIntervalMs = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
    this.retentionDays = options.retentionDays ?? DEFAULT_CLIENT_LOG_RETENTION_DAYS;
  }

  get dir() {
    return this.options.dir;
  }

  /** 追加若干条已脱敏的记录。返回写入完成的 Promise，便于测试与优雅关闭 */
  append(records: unknown[]): Promise<void> {
    if (records.length === 0) return this.writeChain;

    const body = records.map(record => `${JSON.stringify(record)}\n`).join("");
    const file = path.join(this.options.dir, `${FILE_PREFIX}${dayKey(this.now())}${FILE_SUFFIX}`);

    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(this.options.dir, { recursive: true });
        await appendFile(file, body, "utf8");
        await this.pruneIfDue();
      })
      .catch(() => {
        // 日志写入失败绝不能影响正常请求；错误已在调用方记到进程日志
      });

    return this.writeChain;
  }

  /** 等待已排队的写入落盘。请求路径不需要等它，测试与优雅关闭需要 */
  flush(): Promise<void> {
    return this.writeChain;
  }

  /** 按保留天数与总体积上限清理，返回被删掉的文件名 */
  async prune(): Promise<string[]> {
    this.lastPrunedAt = this.now();

    let names: string[];
    try {
      names = (await readdir(this.options.dir)).filter(name => FILE_PATTERN.test(name)).sort();
    } catch {
      return []; // 目录还不存在：没有可清理的
    }

    const removed: string[] = [];
    const cutoff = dayKey(this.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    const survivors: { name: string; size: number }[] = [];

    for (const name of names) {
      const day = name.slice(FILE_PREFIX.length, name.length - FILE_SUFFIX.length);
      if (day < cutoff) {
        await unlink(path.join(this.options.dir, name)).catch(() => undefined);
        removed.push(name);
        continue;
      }
      const size = await stat(path.join(this.options.dir, name))
        .then(info => info.size)
        .catch(() => 0);
      survivors.push({ name, size });
    }

    // 保留期内仍然超量：从最旧的开始删，直到回到上限以内（当天文件留到最后）
    let total = survivors.reduce((sum, file) => sum + file.size, 0);
    for (const file of survivors) {
      if (total <= this.maxTotalBytes) break;
      await unlink(path.join(this.options.dir, file.name)).catch(() => undefined);
      removed.push(file.name);
      total -= file.size;
    }

    return removed;
  }

  private async pruneIfDue() {
    if (this.now() - this.lastPrunedAt < this.pruneIntervalMs) return;
    await this.prune();
  }
}
