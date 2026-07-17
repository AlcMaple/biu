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
    [StoreNameMap.HeartbeatServed]: { bvids: string[]; keys: string[] };
    [StoreNameMap.HeartbeatFavSeeds]: { items: { bvid: string; title?: string; ownerMid?: number }[] };
    [StoreNameMap.HeartbeatSession]: { active: boolean; sessionIds: string[] };
  };
}

export {};
