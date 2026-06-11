import { app } from "electron";
import log from "electron-log";
import fs from "node:fs";
import path from "node:path";

/**
 * 本地数据快照备份。
 *
 * Why：本地收藏夹数据放在 Documents/Biu，用户常用百度网盘等做双向实时同步。
 * 双向同步是「后写覆盖、无版本快照」，任何一台机器写入坏/空数据都会被同步推到
 * 所有机器，把好数据冲掉（真实发生过：重新登录后本地收藏夹元数据被清空并同步出去）。
 * 应用内的写盘保险挡不住同步层面的覆盖，因此在启动时额外做一份独立于网盘的本地快照。
 *
 * 设计：
 * - 快照存到 userData 下（不在网盘同步目录内），网盘出任何问题都不影响快照。
 * - 每次启动一份，目录名为时间戳，只增不覆盖；超出 MAX_BACKUPS 份时删最旧的。
 * - 跳过「本地收藏夹为空」的状态，避免坏状态快照挤掉有效快照。
 */

const MAX_BACKUPS = 10;
const BACKUP_FILES = ["local-favorites.json", "local-fav-items.json", "tags.json"];

const pad = (n: number) => String(n).padStart(2, "0");
const timestamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** 当前本地收藏夹是否有数据（有 isLocal 项才值得备份） */
const hasLocalFavorites = (favoritesPath: string): boolean => {
  try {
    if (!fs.existsSync(favoritesPath)) return false;
    const data = JSON.parse(fs.readFileSync(favoritesPath, "utf8")) as {
      createdFavorites?: { isLocal?: boolean }[];
    };
    const list = Array.isArray(data?.createdFavorites) ? data.createdFavorites : [];
    return list.some(item => item?.isLocal);
  } catch {
    return false;
  }
};

/** 删除超出保留份数的最旧快照 */
const pruneOldBackups = (backupRoot: string) => {
  const dirs = fs
    .readdirSync(backupRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort(); // 时间戳命名，字典序即时间序

  for (let i = 0; i < dirs.length - MAX_BACKUPS; i++) {
    fs.rmSync(path.join(backupRoot, dirs[i]), { recursive: true, force: true });
  }
};

/**
 * 把本地数据文件快照到 userData/data-backups/<时间戳>/。
 * 任何失败都只记日志、不抛出，绝不影响启动。
 * @param sourceDir 本地数据目录（store.ts 的 localDataPath）
 */
export const backupLocalData = (sourceDir: string) => {
  try {
    const favoritesPath = path.join(sourceDir, "local-favorites.json");
    if (!hasLocalFavorites(favoritesPath)) {
      log.info("[backup] 本地收藏夹为空，跳过快照");
      return;
    }

    const backupRoot = path.join(app.getPath("userData"), "data-backups");
    fs.mkdirSync(backupRoot, { recursive: true });

    const dest = path.join(backupRoot, timestamp(new Date()));
    fs.mkdirSync(dest, { recursive: true });

    for (const file of BACKUP_FILES) {
      const src = path.join(sourceDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(dest, file));
      }
    }

    pruneOldBackups(backupRoot);
    log.info(`[backup] 已生成快照：${dest}`);
  } catch (err) {
    log.warn("[backup] 快照失败：", err);
  }
};
