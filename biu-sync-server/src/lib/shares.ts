import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";
import { assertValidMid, withMutex } from "./storage.js";

export interface SharedItem {
  type: 2 | 12;
  rid: string | number;
  title: string;
  bvid?: string;
  cid?: string;
  cover?: string;
  ownerName?: string;
  ownerMid?: number;
  duration?: number | string;
  playCount?: number;
}

export interface SharedFolder {
  code: string;
  mid: string;
  folderId: number;
  title: string;
  cover?: string;
  ownerName?: string;
  updatedAt: number;
  items: SharedItem[];
}

export const MAX_SHARE_ITEMS = 2000;

const CODE_RE = /^[A-Za-z0-9_-]{11}$/;
const BVID_RE = /^BV[0-9A-Za-z]{10}$/;

export class ShareRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const isShareCode = (value: string) => CODE_RE.test(value);

const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : undefined);
// 封面可能是本机 file:// 路径，换台设备就裂，只收公网地址
const url = (value: unknown) => {
  const v = str(value, 500);
  return v && /^(https?:)?\/\//.test(v) ? v : undefined;
};
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

// 只收能在别人设备上播放的在线条目：本地文件的 audioUrl 是本机绝对路径，换设备就失效，不进分享快照
function sanitizeItem(raw: unknown): SharedItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  if (item.source === "local" || item.invalid === true) return null;
  const title = str(item.title, 300);
  if (!title) return null;
  const base = {
    title,
    cover: url(item.cover),
    ownerName: str(item.ownerName, 100),
    ownerMid: num(item.ownerMid),
    playCount: num(item.playCount),
    duration: typeof item.duration === "number" || typeof item.duration === "string" ? item.duration : undefined,
  };
  if (item.type === 2) {
    const bvid = str(item.bvid, 12);
    if (!bvid || !BVID_RE.test(bvid)) return null;
    const cid = typeof item.cid === "string" || typeof item.cid === "number" ? String(item.cid) : undefined;
    return { ...base, type: 2, rid: String(item.rid ?? bvid).slice(0, 32), bvid, cid: cid && /^\d+$/.test(cid) ? cid : undefined };
  }
  if (item.type === 12) {
    const sid = Number(item.rid);
    // 旧数据里没有来源标记的本地歌曲没有作者信息，无法确认是在线音频
    if (!Number.isSafeInteger(sid) || sid <= 0 || (!item.ownerMid && !item.ownerName)) return null;
    return { ...base, type: 12, rid: sid };
  }
  return null;
}

export function parseShareBody(body: unknown) {
  const raw = (body ?? {}) as Record<string, unknown>;
  const folderId = Number(raw.folderId);
  if (!Number.isSafeInteger(folderId) || folderId <= 0) throw new ShareRequestError("歌单 ID 无效");
  const title = str(raw.title, 100)?.trim();
  if (!title) throw new ShareRequestError("歌单名称不能为空");
  if (!Array.isArray(raw.items)) throw new ShareRequestError("歌单内容无效");
  if (raw.items.length > MAX_SHARE_ITEMS) throw new ShareRequestError(`歌单超过 ${MAX_SHARE_ITEMS} 首，无法分享`, 413);
  const items = raw.items.map(sanitizeItem).filter((item): item is SharedItem => item !== null);
  if (!items.length) throw new ShareRequestError("歌单里没有可分享的在线内容（本地文件无法分享给别人）");
  return {
    folderId,
    title,
    cover: url(raw.cover),
    ownerName: str(raw.ownerName, 100),
    items,
  };
}

const sharesDir = () => path.join(config.dataDir, "shares");
const indexPath = (mid: string) => {
  assertValidMid(mid);
  return path.join(config.dataDir, mid, "shares.json");
};

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value), "utf-8");
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

// 同一歌单重复分享沿用同一个链接，只刷新内容：已发出去的链接始终指向最新版本
export function publishShare(mid: string, input: ReturnType<typeof parseShareBody>): Promise<SharedFolder> {
  return withMutex(`share:${mid}`, async () => {
    const index = (await readJson<Record<string, string>>(indexPath(mid))) ?? {};
    const key = String(input.folderId);
    let code = index[key];
    if (!code || !isShareCode(code)) {
      code = crypto.randomBytes(8).toString("base64url");
      await writeJson(indexPath(mid), { ...index, [key]: code });
    }
    const folder: SharedFolder = { code, mid, updatedAt: Date.now(), ...input };
    await writeJson(path.join(sharesDir(), `${code}.json`), folder);
    return folder;
  });
}

export async function readShare(code: string): Promise<SharedFolder | null> {
  if (!isShareCode(code)) return null;
  return readJson<SharedFolder>(path.join(sharesDir(), `${code}.json`));
}
