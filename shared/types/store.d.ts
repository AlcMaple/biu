import type { StoreNameMap } from "../store";

declare global {
  type MediaDownloadsData = Record<string, any>;

  type StoreDataMap = {
    [StoreNameMap.AppSettings]: { appSettings: AppSettings };
    [StoreNameMap.UserLoginInfo]: UserInfo;
    [StoreNameMap.ShortcutSettings]: ShortcutSettings;
    [StoreNameMap.LyricsCache]: Record<string, MusicLyrics>;
    [StoreNameMap.LocalFavorites]: Record<string, any>;
    [StoreNameMap.LocalFavItems]: Record<string, any>;
    [StoreNameMap.Tags]: Record<string, any>;
  };
}

export {};
