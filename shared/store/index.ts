export enum StoreNameMap {
  AppSettings = "app-settings",
  UserLoginInfo = "user-login-info",
  MediaDownloads = "media-downloads",
  ShortcutSettings = "shortcut-settings",
  LyricsCache = "lyrics-cache",
  LocalFavorites = "local-favorites",
  LocalFavItems = "local-fav-items",
  Tags = "tags",
  WindowState = "window-state",
  HeartbeatServed = "heartbeat-served",
  HeartbeatFavSeeds = "heartbeat-fav-seeds",
  HeartbeatSession = "heartbeat-session",
  /** 本地歌单云同步的本地记账（每 mid 的已同步版本号 + 上次同步快照），纯设备本地状态 */
  PlaylistSyncMeta = "playlist-sync-meta",
}
