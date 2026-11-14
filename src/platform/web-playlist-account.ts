export function planAccountPlaylists(meta: PlaylistSyncMetaData, mid: number, legacyClaimed: boolean) {
  // 只要有任何账号在这个浏览器同步过，那份更新前的共用收藏服务器上已经有了，各账号从服务器拿；
  // 都没同步过才说明它只存在这里，交给第一个登录的账号，之后的账号不再认领。
  const anySynced = Object.values(meta).some(entry => Object.keys(entry?.versions ?? {}).length > 0);
  return { copyLegacy: !anySynced && !legacyClaimed, resetBaseline: Boolean(meta[String(mid)]) };
}
