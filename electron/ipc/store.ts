import { ipcMain } from "electron";
import log from "electron-log";

import { updateRankingLocal, type RankingLocalAction } from "@shared/play-ranking";
import { isPlaylistStore, StoreNameMap } from "@shared/store";

import {
  appSettingsStore,
  heartbeatFavSeedsStore,
  heartbeatServedStore,
  heartbeatSessionStore,
  localDataPath,
  legacyPlaylistSyncMeta,
  lyricsCacheStore,
  playCountsStore,
  playRankingSyncStore,
  playlistSyncBackupsStore,
  playlistSyncMetaStore,
  shortcutKeyStore,
  userStore,
} from "../store";
import { DesktopPlaylistAccounts } from "../playlist-accounts";
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
    if (delays[i]) await sleep(delays[i]);
    if (writeSeq.get(name) !== seq) return;
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
  const lastLoginMid = userStore.get("mid");
  const readHistory = () => {
    const meta = legacyPlaylistSyncMeta.store;
    const owners = [
      lastLoginMid,
      ...Object.keys(meta).map(Number),
      ...Object.keys(playlistSyncBackupsStore.store).map(Number),
    ];
    return { owners, meta };
  };
  let accounts: DesktopPlaylistAccounts | undefined;
  const getAccounts = () => (accounts ??= new DesktopPlaylistAccounts(localDataPath, readHistory));
  const assertOwner = (owner?: number): number => {
    if (
      !owner ||
      !Number.isSafeInteger(owner) ||
      owner <= 0 ||
      !userStore.get("isLogin") ||
      userStore.get("mid") !== owner
    )
      throw new Error("歌单账号已切换，请重新打开");
    return owner;
  };
  // 读盘和认领须等此前已接收的写入结束，包括被网盘锁住后正在等待重试的写入。
  let playlistQueue = Promise.resolve();
  function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = playlistQueue.then(operation);
    playlistQueue = next.then(
      () => undefined,
      error => log.error("[store:playlists]", error),
    );
    return next;
  }
  ipcMain.handle(channel.store.preparePlaylistAccount, (_, mid: number, claim?: boolean) =>
    enqueue(() => getAccounts().prepare(assertOwner(mid), claim === true)),
  );
  let rankingQueue: Promise<unknown> = Promise.resolve();
  ipcMain.handle(channel.store.rankingLocal, (_event, action: RankingLocalAction) => {
    const run = rankingQueue.then(async () => {
      const saved = playRankingSyncStore.store;
      const state = updateRankingLocal(Object.keys(saved).length ? saved : undefined, playCountsStore.store, action);
      await setStoreWithRetry("play-ranking-sync", playRankingSyncStore, state);
      return state;
    });
    // 写入失败必须传播给调用方；排队链仍可接受下一次人工触发。
    rankingQueue = run.catch(() => undefined);
    return run;
  });
  ipcMain.handle(channel.store.get, async (_, name: StoreName, owner?: number) => {
    if (isPlaylistStore(name)) {
      if (!owner) return undefined;
      return enqueue(() => getAccounts().accountStore(assertOwner(owner), name).store);
    }
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

    if (name === StoreNameMap.HeartbeatServed) {
      return heartbeatServedStore.store;
    }

    if (name === StoreNameMap.HeartbeatFavSeeds) {
      return heartbeatFavSeedsStore.store;
    }

    if (name === StoreNameMap.HeartbeatSession) {
      return heartbeatSessionStore.store;
    }

    if (name === StoreNameMap.PlaylistSyncMeta) {
      return playlistSyncMetaStore.store;
    }

    if (name === StoreNameMap.PlaylistSyncBackups) {
      return playlistSyncBackupsStore.store;
    }

    if (name === StoreNameMap.PlayCounts) {
      return playCountsStore.store;
    }
  });

  ipcMain.handle(channel.store.set, async (_, name: StoreName, value: unknown, owner?: number) => {
    if (isPlaylistStore(name)) {
      if (!owner) return;
      const mid = assertOwner(owner);
      return enqueue(() => setStoreWithRetry(String(mid) + ":" + name, getAccounts().accountStore(mid, name), value));
    }
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

      if (name === StoreNameMap.HeartbeatServed) {
        await setStoreWithRetry(name, heartbeatServedStore, value);
      }

      if (name === StoreNameMap.HeartbeatFavSeeds) {
        await setStoreWithRetry(name, heartbeatFavSeedsStore, value);
      }

      if (name === StoreNameMap.HeartbeatSession) {
        await setStoreWithRetry(name, heartbeatSessionStore, value);
      }

      if (name === StoreNameMap.PlaylistSyncMeta) {
        await setStoreWithRetry(name, playlistSyncMetaStore, value);
      }

      if (name === StoreNameMap.PlaylistSyncBackups) {
        await setStoreWithRetry(name, playlistSyncBackupsStore, value);
      }

      if (name === StoreNameMap.PlayCounts) {
        await setStoreWithRetry(name, playCountsStore, value);
      }
    } catch (err) {
      log.error(`[store:set] Error setting store ${String(name)}:`, err);
      throw err;
    }
  });

  ipcMain.handle(channel.store.clear, async (_, name: StoreName, owner?: number) => {
    if (isPlaylistStore(name)) {
      if (!owner) return;
      const mid = assertOwner(owner);
      return enqueue(() => getAccounts().accountStore(mid, name).clear());
    }
    if (name === StoreNameMap.AppSettings) {
      appSettingsStore.clear();
    }

    if (name === StoreNameMap.UserLoginInfo) {
      writeSeq.set(name, (writeSeq.get(name) ?? 0) + 1);
      userStore.clear();
    }

    if (name === StoreNameMap.ShortcutSettings) {
      shortcutKeyStore.clear();
    }

    if (name === StoreNameMap.LyricsCache) {
      lyricsCacheStore.clear();
    }

    if (name === StoreNameMap.HeartbeatServed) {
      heartbeatServedStore.clear();
    }

    if (name === StoreNameMap.HeartbeatFavSeeds) {
      heartbeatFavSeedsStore.clear();
    }

    if (name === StoreNameMap.HeartbeatSession) {
      heartbeatSessionStore.clear();
    }

    if (name === StoreNameMap.PlaylistSyncMeta) {
      playlistSyncMetaStore.clear();
    }

    if (name === StoreNameMap.PlaylistSyncBackups) {
      playlistSyncBackupsStore.clear();
    }

    if (name === StoreNameMap.PlayCounts) {
      playCountsStore.clear();
    }

    return true;
  });
}
