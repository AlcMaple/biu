import fs from "node:fs/promises";
import path from "node:path";

import type { StoreData } from "./merge.js";
import type { StoreName } from "./store-names.js";

import { config } from "./config.js";
import { notifyChange } from "./events.js";
import { STORE_NAMES } from "./store-names.js";

export interface Envelope {
  version: number;
  updatedAt: number;
  data: StoreData;
}

const EMPTY_ENVELOPE: Envelope = { version: 0, updatedAt: 0, data: {} };

/** 每个 store 保留多少份历史版本（覆盖写之前另存，见 saveHistory） */
const HISTORY_KEEP = 10;

/** mid 必须是纯数字（B 站 uid），拒绝一切非数字值，防止路径穿越 */
export function assertValidMid(mid: string): asserts mid is string {
  if (!/^\d+$/.test(mid)) {
    throw new Error(`invalid mid: ${mid}`);
  }
}

function userDir(mid: string): string {
  assertValidMid(mid);
  return path.join(config.dataDir, mid);
}

function storeFilePath(mid: string, store: StoreName): string {
  return path.join(userDir(mid), `${store}.json`);
}

/**
 * 每个 mid 一条串行队列，保证同一用户的并发请求在本进程内不会互相踩踏
 * 读改写。**只在单进程部署下成立** —— pm2 必须用 fork 模式单实例，
 * 开 cluster 会导致每个子进程各有一份队列，这层保护形同虚设。
 */
const mutexQueues = new Map<string, Promise<unknown>>();

function withMutex<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = mutexQueues.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  // 队列里只保留"最新一个待完成的 promise"，避免 Map 无限增长；
  // catch 是为了不让某次失败的任务把队列卡死。
  mutexQueues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

async function readEnvelope(mid: string, store: StoreName): Promise<Envelope> {
  const filePath = storeFilePath(mid, store);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as Envelope;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return EMPTY_ENVELOPE;
    }
    throw err;
  }
}

async function writeEnvelope(mid: string, store: StoreName, envelope: Envelope): Promise<void> {
  const dir = userDir(mid);
  await fs.mkdir(dir, { recursive: true });
  const filePath = storeFilePath(mid, store);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(envelope), "utf-8");
    // 同分区内 rename 是原子操作，避免读到半截写入的文件
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    // 写入失败时清理掉临时文件，不留垃圾占磁盘
    await fs.unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}

/**
 * 覆盖写之前，把当前版本另存到 `{mid}/history/` 下。
 *
 * Why: 墓碑机制只保留"这条被删了"，payload 是直接丢弃的——一旦客户端因为任何 bug
 * 推上来一批 remove，服务端如实执行后数据在云端就**不可逆**了（真实事故：客户端在
 * store 未就绪时把整个歌单 diff 成全量删除，云端只剩墓碑）。历史版本是最后一道防线：
 * 客户端可以出错，服务端不能因此丢失用户数据。
 *
 * 单份历史就是一份完整快照（单用户几百 KB 量级），保留 HISTORY_KEEP 份；机器磁盘
 * 还有 28G 空闲，这个量级完全撑得住，比丢数据划算得多。
 */
async function saveHistory(mid: string, store: StoreName, envelope: Envelope): Promise<void> {
  // 空 envelope（用户第一次同步，文件还不存在）没有保存价值
  if (envelope.version === 0 && Object.keys(envelope.data).length === 0) return;

  const dir = path.join(userDir(mid), "history");
  await fs.mkdir(dir, { recursive: true });
  const name = `${store}-v${String(envelope.version).padStart(6, "0")}-${envelope.updatedAt}.json`;
  await fs.writeFile(path.join(dir, name), JSON.stringify(envelope), "utf-8");

  const entries = (await fs.readdir(dir)).filter(f => f.startsWith(`${store}-`)).sort(); // 版本号定长补零，字典序即版本序
  for (const stale of entries.slice(0, Math.max(0, entries.length - HISTORY_KEEP))) {
    await fs.unlink(path.join(dir, stale)).catch(() => undefined);
  }
}

export async function getEnvelope(mid: string, store: StoreName): Promise<Envelope> {
  return withMutex(`${mid}:${store}`, () => readEnvelope(mid, store));
}

/**
 * `mutate` 在互斥队列内拿到当前 envelope，返回下一版 envelope 并原子落盘。
 * 所有"读 - 改 - 写"必须走这个函数，禁止在别处直接 readEnvelope 后自行 write。
 */
export async function mutateEnvelope(
  mid: string,
  store: StoreName,
  mutate: (current: Envelope) => Envelope,
): Promise<Envelope> {
  return withMutex(`${mid}:${store}`, async () => {
    const current = await readEnvelope(mid, store);
    const next = mutate(current);
    // 覆盖前先存历史：历史保存失败绝不能阻断正常同步，但要留日志
    await saveHistory(mid, store, current).catch(err =>
      console.error(`[storage] history save failed mid=${mid} store=${store}`, err),
    );
    await writeEnvelope(mid, store, next);
    // 落盘之后再广播，保证被唤醒的 watch 请求一定读得到新版本
    notifyChange(mid);
    return next;
  });
}

/** 三个 store 的当前版本号，供长轮询比对（只读 version 字段，但文件本来就整份读，无额外成本） */
export async function getVersions(mid: string): Promise<Record<string, number>> {
  const entries = await Promise.all(
    STORE_NAMES.map(async store => [store, (await readEnvelope(mid, store)).version] as const),
  );
  return Object.fromEntries(entries);
}

/** 供每日清理任务遍历所有用户目录用 */
export async function listUserMids(): Promise<string[]> {
  try {
    const entries = await fs.readdir(config.dataDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory() && /^\d+$/.test(e.name)).map(e => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
