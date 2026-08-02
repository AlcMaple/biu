import fs from "node:fs/promises";
import path from "node:path";

import type { StoreData } from "./merge.js";
import type { StoreName } from "./store-names.js";

import { config } from "./config.js";

export interface Envelope {
  version: number;
  updatedAt: number;
  data: StoreData;
}

const EMPTY_ENVELOPE: Envelope = { version: 0, updatedAt: 0, data: {} };

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
    await writeEnvelope(mid, store, next);
    return next;
  });
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
