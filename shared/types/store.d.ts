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
    [StoreNameMap.PlaylistSyncMeta]: PlaylistSyncMetaData;
  };

  /**
   * 每个 mid 一份：本地歌单同步的记账信息，纯设备本地状态，不参与云同步本身。
   * 某个 store 是否"已完成首次迁移"用 `versions[store] !== undefined` 判断，
   * 不单独存一个全局 migrated 标记——三个 store 各自独立触发同步，没有统一时机。
   */
  type PlaylistSyncMetaData = Record<
    string,
    {
      /** 每个 store 最近一次成功同步后的 version */
      versions: Record<string, number>;
      /** 每个 store 最近一次成功同步后的服务端快照，用作下次本地变更 diff 的基线 */
      snapshots: Record<string, Record<string, unknown>>;
      /**
       * 每个 store 首次迁移前的本地数据快照，只写一次不再更新，纯粹是"万一同步逻辑
       * 有 bug 把本地数据搞坏了，还能从这里手动找回原始数据"的安全网，不参与任何
       * 同步计算。
       */
      preMigrationBackups?: Record<string, Record<string, unknown>>;
    }
  >;
}

export {};
