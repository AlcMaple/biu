/**
 * biu-sync-server 部署地址，见 docs/本地歌单同步-服务器部署指南.md。
 * 走 HTTPS（Let's Encrypt，certbot 自动续期）——B 站登录 cookie 会经这个接口传输，
 * 不能走明文 HTTP。
 */
export const SYNC_SERVER_BASE_URL = "https://biu.alcmaple.cn/api";

/** 本地变更后防抖多久才上报，避免用户连续操作时每次都打一次请求 */
export const SYNC_DEBOUNCE_MS = 800;
