import { ipcMain } from "electron";
import log from "electron-log";

import { StoreNameMap } from "@shared/store";

import { appSettingsStore, localFavItemsStore, localFavoritesStore, lyricsCacheStore, shortcutKeyStore, tagsStore, userStore } from "../store";
import { channel } from "./channel";

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
        appSettingsStore.set(value);
      }

      if (name === StoreNameMap.UserLoginInfo) {
        userStore.set(value);
      }

      if (name === StoreNameMap.ShortcutSettings) {
        shortcutKeyStore.set(value);
      }

      if (name === StoreNameMap.LyricsCache) {
        lyricsCacheStore.set(value);
      }

      if (name === StoreNameMap.LocalFavorites) {
        localFavoritesStore.set(value);
      }

      if (name === StoreNameMap.LocalFavItems) {
        localFavItemsStore.set(value);
      }

      if (name === StoreNameMap.Tags) {
        tagsStore.set(value);
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
