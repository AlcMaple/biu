import { app } from "electron";
import Store from "electron-store";
import path from "node:path";

import { defaultAppSettings } from "@shared/settings/app-settings";
import { defaultShortcutSettings } from "@shared/settings/shortcut-settings";
import { StoreNameMap } from "@shared/store";

import type { FullMediaDownloadTask } from "./ipc/download/types";

import { getUserDataPath } from "./utils";

export const appSettingsStore = new Store<{ appSettings: AppSettings }>({
  name: StoreNameMap.AppSettings,
  cwd: getUserDataPath(),
  defaults: {
    appSettings: {
      ...defaultAppSettings,
      downloadPath: app.getPath("downloads"),
    },
  },
});

export const userStore = new Store<UserInfo>({
  name: StoreNameMap.UserLoginInfo,
  cwd: getUserDataPath(),
  encryptionKey: StoreNameMap.UserLoginInfo,
});

export const mediaDownloadsStore = new Store<Record<string, FullMediaDownloadTask>>({
  name: StoreNameMap.MediaDownloads,
  cwd: getUserDataPath(),
});

export const shortcutKeyStore = new Store<ShortcutSettings>({
  name: StoreNameMap.ShortcutSettings,
  cwd: getUserDataPath(),
  defaults: {
    ...defaultShortcutSettings,
  },
});

export const lyricsCacheStore = new Store<Record<string, MusicLyrics>>({
  name: StoreNameMap.LyricsCache,
  cwd: getUserDataPath(),
  defaults: {},
});

export const windowStateStore = new Store<{
  desktopLyrics?: Electron.Rectangle;
}>({
  name: StoreNameMap.WindowState,
  cwd: getUserDataPath(),
  defaults: {},
});

// —— 私人FM（心动模式）持久化：均为推荐状态、非用户资料，放应用数据目录即可 ——

/** 已推历史（跨会话/跨天不重复推荐） */
export const heartbeatServedStore = new Store<{ bvids: string[]; keys: string[] }>({
  name: StoreNameMap.HeartbeatServed,
  cwd: getUserDataPath(),
  defaults: { bvids: [], keys: [] },
});

/** 收藏动作种子（续供二度扩展） */
export const heartbeatFavSeedsStore = new Store<{ items: { bvid: string; title?: string; ownerMid?: number }[] }>({
  name: StoreNameMap.HeartbeatFavSeeds,
  cwd: getUserDataPath(),
  defaults: { items: [] },
});

/** 会话（重启后接着放） */
export const heartbeatSessionStore = new Store<{ active: boolean; sessionIds: string[] }>({
  name: StoreNameMap.HeartbeatSession,
  cwd: getUserDataPath(),
  defaults: { active: false, sessionIds: [] },
});

/** 本地收藏夹/歌曲/标签数据目录（用户可将其放进网盘同步目录实现跨端同步） */
export const localDataPath = path.join(app.getPath("documents"), "Biu");

export const localFavoritesStore = new Store<Record<string, any>>({
  name: StoreNameMap.LocalFavorites,
  cwd: localDataPath,
});

export const localFavItemsStore = new Store<Record<string, any>>({
  name: StoreNameMap.LocalFavItems,
  cwd: localDataPath,
});

export const tagsStore = new Store<Record<string, any>>({
  name: StoreNameMap.Tags,
  cwd: localDataPath,
});
