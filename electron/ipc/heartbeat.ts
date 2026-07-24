import { ipcMain } from "electron";
import isDev from "electron-is-dev";
import log from "electron-log";
import fs from "node:fs";
import path from "node:path";

import { getUserDataPath } from "../utils";
import { channel } from "./channel";

/**
 * 私人FM 调试日志目录。
 * 开发期落项目根 `logs/heartbeat/`（`.gitignore` 已忽略 `logs`），方便随手翻看；
 * 打包后落用户数据目录（`biu-dev` / userData），避免往只读的安装目录写。
 */
function heartbeatLogDir() {
  const base = isDev ? process.cwd() : getUserDataPath();
  return path.join(base, "logs", "heartbeat");
}

/**
 * 当前这一轮 FM 的日志文件路径。
 * 「重开一轮」(`reset: true`) 时置为新文件；之后每「切歌」一首追加一行，行号即该歌在播放队列里的序号
 * （由渲染端算好用 `seq` 传入，所以主进程不必自己记计数、重启后也不用回读行数补编号）。
 * 主进程重启后为 null；此时「接着放」的追加会回到目录里最新的一轮文件继续写（见 latestRoundFile），
 * 只有真正「重开一轮」才新开文件。
 */
let currentRoundFile: string | null = null;

/** 目录里最新的一轮日志文件（文件名是 fileStamp 时间戳，字典序即时间序）；没有则返回 null */
function latestRoundFile(dir: string): string | null {
  try {
    const files = fs
      .readdirSync(dir)
      .filter(f => f.startsWith("fm-") && f.endsWith(".txt"))
      .sort();
    const last = files.at(-1);
    return last ? path.join(dir, last) : null;
  } catch {
    return null;
  }
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** 文件名用的紧凑时间戳：YYYYMMDD-HHmmss */
function fileStamp(d: Date) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 正文用的可读时间戳：YYYY-MM-DD HH:mm:ss */
function readableStamp(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 每首日志行的时间：HH:mm:ss */
function timeStamp(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface HeartbeatDebugLogPayload {
  /** true = 重开一轮：开一个新文件并写轮次头 */
  reset?: boolean;
  /** 刚切走的一首歌名（追加一行）；不传表示仅开新一轮 */
  song?: string;
  /** 该歌在播放队列里的序号（1 起），作为日志行号：区分「同名但不同队列项」的歌（如第 1 首和第 6 首都叫 A） */
  seq?: number;
}

/**
 * 【调试】私人FM 按切歌逐首日志：每次切歌把切走的那首追加一行到 `logs/heartbeat/fm-<时间戳>.txt`，
 * 行首带该歌在播放队列里的序号。重开一轮开新文件并写轮次头（不再一次性 dump 整个队列）。
 */
export function registerHeartbeatHandlers() {
  ipcMain.handle(channel.heartbeat.debugLog, async (_, payload: HeartbeatDebugLogPayload): Promise<string | null> => {
    try {
      const { reset, song, seq } = payload;
      const now = new Date();
      const dir = heartbeatLogDir();
      fs.mkdirSync(dir, { recursive: true });

      if (reset) {
        // 重开一轮：永远开新文件、写轮次头
        currentRoundFile = path.join(dir, `fm-${fileStamp(now)}.txt`);
        fs.appendFileSync(currentRoundFile, `===== 新一轮 · ${readableStamp(now)} =====\n`, "utf8");
      }

      if (song !== undefined) {
        // 主进程重启后「接着放」：接着写上一轮最新文件；没有则新建带轮次头的文件
        if (!currentRoundFile) {
          const latest = latestRoundFile(dir);
          if (latest) {
            currentRoundFile = latest;
            fs.appendFileSync(currentRoundFile, `----- 重启后接着放 · ${readableStamp(now)} -----\n`, "utf8");
          } else {
            currentRoundFile = path.join(dir, `fm-${fileStamp(now)}.txt`);
            fs.appendFileSync(currentRoundFile, `===== 新一轮 · ${readableStamp(now)} =====\n`, "utf8");
          }
        }
        // 行号用渲染端传来的队列序号（1 起）；缺省时用「-」占位
        const num = seq !== undefined ? String(seq).padStart(3, " ") : "  -";
        fs.appendFileSync(currentRoundFile, `${num}. ${song || "(未知)"}  ·  ${timeStamp(now)}\n`, "utf8");
      }

      return currentRoundFile;
    } catch (err) {
      log.error("[heartbeat] debug log failed:", err);
      return null;
    }
  });
}
