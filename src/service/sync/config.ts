/**
 * biu-sync-server
 * 走 HTTPS（Let's Encrypt，certbot 自动续期）——B 站登录 cookie 会经这个接口传输，
 * 不能走明文 HTTP。
 */
export const SYNC_SERVER_BASE_URL = "https://biu.alcmaple.cn/api";

/**
 * 同步记账的世代号。**升上来的版本一旦改了这个值，本地已有的基线就作废一次**，
 * 下次同步强制走 `migrate`（`diffForMigration` 只产生 upsert，绝不产生 remove）。
 *
 * Why: 2.5.0 的同步 bug 会让设备本地数据和它的基线严重不一致（本地被清空/回退，
 * 基线还停在事故前）。修好后的版本如果直接拿旧基线做 diff，"基线有、本地没有"会被
 * 算成删除推上云，把另一台设备刚恢复的好数据删掉。作废一次基线、走一次并集合并，
 * 是这次升级唯一安全的过渡方式。代价是那台设备上"曾经删掉的条目"可能被云端复活，
 * 比误删数据轻得多。
 */
export const SYNC_META_EPOCH = 2;

/** 本地变更后防抖多久才上报，避免用户连续操作时每次都打一次请求 */
export const SYNC_DEBOUNCE_MS = 800;

/**
 * 每个 store 保留多少份推送前的本地备份。
 * 单份是一整个歌单快照（几十~几百 KB 量级），10 份覆盖最近 10 次实际变更，
 * 足够回溯到出问题之前，也不至于把用户数据目录撑大。
 */
export const SYNC_BACKUP_KEEP = 10;

/** 通知通道请求的客户端超时：必须大于服务端挂起上限（25s），否则每轮都被本地判超时 */
export const WATCH_REQUEST_TIMEOUT_MS = 35_000;

/**
 * 通知通道断线后的重连退避（连续失败第 n 次取第 n 项，超出取最后一项）。
 *
 * 前几档要短：断线期间是**通知盲区**，另一台设备的改动进不来，拖久了就等于没有实时。
 * 后面收敛到 30s：服务真挂了时不空转打请求。没有定时轮询兜底，这条通道就是唯一的
 * 常驻机制，所以它自己的恢复速度直接决定实时性。
 */
export const WATCH_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];
