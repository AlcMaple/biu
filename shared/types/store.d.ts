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
    [StoreNameMap.PlaylistSyncBackups]: PlaylistSyncBackupsData;
  };

  /**
   * 每 mid、每 store 一条按时间倒序的备份队列（最新在前），每次同步**推送之前**
   * 把本地现状原样存一份。`preMigrationBackups` 只写一次、只能救回首次迁移那天的
   * 状态，救不了之后新增的数据（真实事故：同步 bug 清空数据后只找回几天前的版本），
   * 这条滚动队列就是为了补上那段窗口。纯本地，不参与任何同步计算。
   */
  type PlaylistSyncBackupsData = Record<string, Record<string, { at: number; snapshot: Record<string, unknown> }[]>>;

  /**
   * 每个 mid 一份：本地歌单同步的记账信息，纯设备本地状态，不参与云同步本身。
   * 某个 store 是否"已完成首次迁移"用 `versions[store] !== undefined` 判断，
   * 不单独存一个全局 migrated 标记——三个 store 各自独立触发同步，没有统一时机。
   */
  type PlaylistSyncMetaData = Record<
    string,
    {
      /**
       * 记账世代号（见 `src/service/sync/config.ts` 的 `SYNC_META_EPOCH`）。
       * 与当前代码的世代号不一致时，基线视为不可信，强制走一次只增不删的迁移。
       */
      epoch?: number;
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
