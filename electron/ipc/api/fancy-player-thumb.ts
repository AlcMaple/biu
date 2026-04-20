import { app, ipcMain } from "electron";
import log from "electron-log";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { channel } from "../channel";

// 读取源文件 IPC 的大小上限，防止误传超大文件（100MB）
const MAX_SOURCE_FILE_BYTES = 100 * 1024 * 1024;

function thumbsDir(): string {
  return path.join(app.getPath("userData"), "fancy-player-thumbs");
}

function thumbPathFor(sourcePath: string): string {
  const hash = crypto.createHash("sha1").update(sourcePath).digest("hex");
  return path.join(thumbsDir(), `${hash}.jpg`);
}

async function ensureThumbsDir() {
  try {
    await fsp.mkdir(thumbsDir(), { recursive: true });
  } catch (err) {
    log.error("[fancy-player-thumb] mkdir failed:", err);
  }
}

export function registerFancyPlayerThumbHandlers() {
  // 命中缓存则返回缩略图绝对路径，否则返回 null
  ipcMain.handle(channel.fancyPlayer.peekThumb, async (_event, sourcePath: string) => {
    if (!sourcePath) return null;
    const target = thumbPathFor(sourcePath);
    try {
      await fsp.access(target);
      return target;
    } catch {
      return null;
    }
  });

  // 读取原文件字节并交给渲染进程解码（Chromium 支持 PNG/JPEG/WebP/AVIF/GIF/BMP 等）
  ipcMain.handle(channel.fancyPlayer.readSourceFile, async (_event, sourcePath: string) => {
    if (!sourcePath) return null;
    try {
      const stat = await fsp.stat(sourcePath);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_SOURCE_FILE_BYTES) {
        log.warn("[fancy-player-thumb] skip file:", sourcePath, "size:", stat.size);
        return null;
      }
      const buf = await fsp.readFile(sourcePath);
      // 以 Uint8Array 形式返回，结构化克隆通过 IPC 零拷贝传输
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (err) {
      log.error("[fancy-player-thumb] read failed:", sourcePath, err);
      return null;
    }
  });

  // 写入渲染进程生成好的 JPEG 缩略图数据
  ipcMain.handle(channel.fancyPlayer.saveThumb, async (_event, sourcePath: string, data: Uint8Array) => {
    if (!sourcePath || !data || data.byteLength === 0) return null;
    const target = thumbPathFor(sourcePath);
    try {
      await ensureThumbsDir();
      await fsp.writeFile(target, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
      return target;
    } catch (err) {
      log.error("[fancy-player-thumb] save failed:", sourcePath, err);
      return null;
    }
  });

  ipcMain.handle(channel.fancyPlayer.removeThumb, async (_event, sourcePath: string) => {
    if (!sourcePath) return false;
    try {
      await fsp.unlink(thumbPathFor(sourcePath));
      return true;
    } catch {
      return false;
    }
  });
}
