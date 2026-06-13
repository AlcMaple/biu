import { ipcMain } from "electron";
import log from "electron-log";

import { StoreNameMap } from "@shared/store";

import {
  appSettingsStore,
  localFavItemsStore,
  localFavoritesStore,
  lyricsCacheStore,
  shortcutKeyStore,
  tagsStore,
  userStore,
} from "../store";
import { channel } from "./channel";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 文件被其他进程占用（网盘同步、杀毒扫描等）导致的临时性写入失败 */
const isFileLockError = (err: unknown) => {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
};

/** 每个 store 的最新写入序号：重试期间若来了更新的写入，旧数据直接放弃，避免回写覆盖新数据 */
const writeSeq = new Map<string, number>();

/**
 * 带退避重试的写入。本地数据目录在“文档\Biu”（用户可能放进网盘同步目录），
 * 文件偶发被占用时 rename 会报 EPERM，直接丢弃本次写入会丢数据，这里重试兜底。
 */
async function setStoreWithRetry(name: string, store: { set: (value: any) => void }, value: any) {
  const seq = (writeSeq.get(name) || 0) + 1;
  writeSeq.set(name, seq);

  const delays = [0, 200, 500, 1000, 2000];
  for (let i = 0; i < delays.length; i++) {
    if (writeSeq.get(name) !== seq) return;
    if (delays[i]) await sleep(delays[i]);
    try {
      store.set(value);
      return;
    } catch (err) {
      if (!isFileLockError(err) || i === delays.length - 1) throw err;
      log.warn(`[store:set] ${name} 文件被占用，${delays[i + 1]}ms 后重试（第 ${i + 1} 次失败）`);
    }
  }
}

export function registerStoreHandlers() {
  ipcMain.handle(channel.store.get, async (_, name: StoreName) => {
    if (name === StoreNameMap.AppSettings) {
      return appSettingsStore.store;
    }

    if (name === StoreNameMap.UserLoginInfo) {
      return userStore.store;
    }

    if (name === StoreNameMap.ShortcutSettings) {
      return shortcutKeyStore.store;
    }

    if (name === StoreNameMap.LyricsCache) {
      return lyricsCacheStore.store;
    }

    if (name === StoreNameMap.LocalFavorites) {
      return localFavoritesStore.store;
    }

    if (name === StoreNameMap.LocalFavItems) {
      return localFavItemsStore.store;
    }

    if (name === StoreNameMap.Tags) {
      return tagsStore.store;
    }
  });

  ipcMain.handle(channel.store.set, async (_, name: StoreName, value: any) => {
    try {
      // 确保 value 是有效对象，防止 electron-store 报错
      if (value === null || value === undefined) {
        log.warn(`[store:set] Received invalid value for ${String(name)}:`, value);
        return;
      }

      if (name === StoreNameMap.AppSettings) {
        await setStoreWithRetry(name, appSettingsStore, value);
      }

      if (name === StoreNameMap.UserLoginInfo) {
        await setStoreWithRetry(name, userStore, value);
      }

      if (name === StoreNameMap.ShortcutSettings) {
        await setStoreWithRetry(name, shortcutKeyStore, value);
      }

      if (name === StoreNameMap.LyricsCache) {
        await setStoreWithRetry(name, lyricsCacheStore, value);
      }

      if (name === StoreNameMap.LocalFavorites) {
        await setStoreWithRetry(name, localFavoritesStore, value);
      }

      if (name === StoreNameMap.LocalFavItems) {
        await setStoreWithRetry(name, localFavItemsStore, value);
      }

      if (name === StoreNameMap.Tags) {
        await setStoreWithRetry(name, tagsStore, value);
      }
    } catch (err) {
      log.error(`[store:set] Error setting store ${String(name)}:`, err);
    }
  });

  ipcMain.handle(channel.store.clear, async (_, name: StoreName) => {
    if (name === StoreNameMap.AppSettings) {
      appSettingsStore.clear();
    }

    if (name === StoreNameMap.UserLoginInfo) {
      userStore.clear();
    }

    if (name === StoreNameMap.ShortcutSettings) {
      shortcutKeyStore.clear();
    }

    if (name === StoreNameMap.LyricsCache) {
      lyricsCacheStore.clear();
    }

    if (name === StoreNameMap.LocalFavorites) {
      localFavoritesStore.clear();
    }

    if (name === StoreNameMap.LocalFavItems) {
      localFavItemsStore.clear();
    }

    if (name === StoreNameMap.Tags) {
      tagsStore.clear();
    }

    return true;
  });
}
