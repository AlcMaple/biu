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
