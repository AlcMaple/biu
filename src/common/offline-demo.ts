/**
 * Build-time flag for the documentation prototype.
 *
 * The prototype deliberately runs the real React route tree with local fixtures. It is
 * never enabled for the normal Electron, Android, iOS, or Web builds.
 */
export const isOfflineDemo = process.env.BIU_OFFLINE_DEMO === "true";

// 本地沙盒（`pnpm sandbox`，见 docs/ideas/008-本地沙盒测试.md）复用离线 Demo 的 B 站假数据，
// 但要真播放、连本机 mock 对齐服务；离线 Demo 必须零副作用，所以两者在「有没有副作用」处分叉
// 注意：动态 import 沙盒代码的地方要直接写 `process.env.BIU_SANDBOX === "true"`，不能用 isSandbox。
// 打包器只在解析时折叠被 define 替换的字面表达式；跨模块的常量折叠不了，`import()` 照样会被打成产物里的异步包
export const isSandbox = process.env.BIU_SANDBOX === "true";
export const isStaticDemo = isOfflineDemo && !isSandbox;
