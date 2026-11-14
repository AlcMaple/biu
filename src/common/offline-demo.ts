/**
 * Build-time flag for the documentation prototype.
 *
 * The prototype deliberately runs the real React route tree with local fixtures. It is
 * never enabled for the normal Electron or Web builds.
 */
export const isOfflineDemo = process.env.BIU_OFFLINE_DEMO === "true";

// 本地沙盒（`pnpm sandbox`，见 docs/ideas/008-本地沙盒测试.md）不是离线 Demo：它跑真实 Web 代码和 BFF，
// 只是 BFF 的上游换成了本机假 B 站，所以这里只用来隔离存储和挂沙盒菜单。
// 注意：动态 import 沙盒代码的地方要直接写 `process.env.BIU_SANDBOX === "true"`，不能用 isSandbox。
// 打包器只在解析时折叠被 define 替换的字面表达式；跨模块的常量折叠不了，`import()` 照样会被打成产物里的异步包
export const isSandbox = process.env.BIU_SANDBOX === "true";
export const isStaticDemo = isOfflineDemo;
