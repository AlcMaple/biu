import { app } from "electron";
import isDev from "electron-is-dev";
import log from "electron-log";
import ffmpeg from "fluent-ffmpeg";
import fs from "node:fs";
import path from "node:path";

import { ELECTRON_ICON_BASE_PATH } from "@shared/path";

import { appSettingsStore } from "./store";

export const IconBase = isDev ? process.cwd() : process.resourcesPath;

export const getUserDataPath = () => {
  return isDev ? path.join(app.getPath("appData"), `biu-dev`) : app.getPath("userData");
};

export const getWindowIcon = () =>
  process.platform === "darwin"
    ? undefined
    : path.resolve(
        IconBase,
        ELECTRON_ICON_BASE_PATH,
        process.platform === "win32" ? (isDev ? "dev.ico" : "logo.ico") : "logo.png",
      );

/**
 * 在系统 PATH 中查找 ffmpeg 可执行文件。
 * Windows 内置的 ffmpeg 是精简构建（仅含 remux 所需组件），
 * 系统安装的完整版 ffmpeg 支持 wav 等更多格式，听歌识曲等功能需要优先使用。
 */
const findFfmpegInPath = (): string | undefined => {
  const exeName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const separator = process.platform === "win32" ? ";" : ":";
  const dirs = (process.env.PATH || "").split(separator);
  for (const dir of dirs) {
    if (!dir) continue;
    const p = path.join(dir, exeName);
    if (fs.existsSync(p)) {
      log.info(`Found ffmpeg in PATH at ${p}`);
      return p;
    }
  }
  return undefined;
};

/**
 * 解析 ffmpeg 可执行文件的绝对路径。
 * @param preferSystem 优先使用系统完整版 ffmpeg（默认 false）。
 *   内置 ffmpeg 是精简构建，不含 wav/pcm 编解码器；听歌识曲等需要转码的场景应传 true。
 */
export const getFfmpegPath = (preferSystem = false): string | undefined => {
  // 1. 用户手动配置的路径，始终最高优先级
  try {
    const settings = appSettingsStore.get("appSettings");
    if (settings?.ffmpegPath && fs.existsSync(settings.ffmpegPath)) {
      log.info(`Found user configured ffmpeg at ${settings.ffmpegPath}`);
      return settings.ffmpegPath;
    }
  } catch (err) {
    log.error("Error reading ffmpeg path from settings:", err);
  }

  // 2. 系统路径（macOS/Linux 常见位置 + 所有平台的 PATH 查找）
  const findSystemFfmpeg = (): string | undefined => {
    if (process.platform === "darwin" || process.platform === "linux") {
      const paths = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", "/snap/bin/ffmpeg"];
      for (const p of paths) {
        if (fs.existsSync(p)) {
          log.info(`Found ffmpeg at ${p}`);
          return p;
        }
      }
    }
    return findFfmpegInPath();
  };

  // 3. 内置二进制
  const findBundledFfmpeg = (): string | undefined => {
    const getFfmpegName = () => {
      switch (process.platform) {
        case "win32":
          return "ffmpeg.exe";
        case "darwin":
          return process.arch === "arm64" ? "ffmpeg-mac-arm64" : "ffmpeg-mac-x64";
        case "linux":
          return "ffmpeg-linux";
        default:
          return "ffmpeg";
      }
    };

    const localFfmpegPath = path.join(
      isDev ? process.cwd() : process.resourcesPath,
      "electron",
      "ffmpeg",
      getFfmpegName(),
    );

    if (fs.existsSync(localFfmpegPath)) {
      if (process.platform !== "win32") {
        try {
          fs.chmodSync(localFfmpegPath, "755");
        } catch (err) {
          log.error(`Failed to chmod ffmpeg at ${localFfmpegPath}`, err);
        }
      }
      return localFfmpegPath;
    }
    return undefined;
  };

  if (preferSystem) {
    return findSystemFfmpeg() ?? findBundledFfmpeg();
  }
  return findBundledFfmpeg() ?? findSystemFfmpeg();
};

export const fixFfmpegPath = () => {
  const p = getFfmpegPath();
  if (p) {
    ffmpeg.setFfmpegPath(p);
  }
};

const entities = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
  nbsp: " ",
};

/**
 * 将包含 HTML 和特殊字符的字符串转换为合法的文件名
 */
export function sanitizeFilename(input?: string, replacement = "_") {
  if (!input) return "";

  const decoded = input.replace(/&([a-z0-9]+|#[0-9]{1,6}|#x[0-9a-f]{1,6});/gi, (match, entity) => {
    return entities[entity.toLowerCase()] || match;
  });

  const noHtml = decoded.replace(/<[^>]+>/g, "");

  // 替换 Windows/Linux 文件名非法字符
  // 非法集：\ / : * ? " < > | 以及控制字符
  // eslint-disable-next-line no-control-regex
  const illegalRe = /[\\/:*?"<>|\x00-\x1f\x80-\x9f]/g;
  const sanitized = noHtml.replace(illegalRe, replacement);

  return sanitized.replace(/\s+/g, " ").trim().replace(/\.$/, "").slice(0, 255); // 截断长度，防止文件名过长
}
