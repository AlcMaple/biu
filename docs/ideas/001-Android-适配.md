# 001 - Android 适配

> 开始：2026-05-12

## 🎯 这个阶段的产物

Biu 在 Android 上可安装运行，核心功能（登录 / 搜索 / 播放 / 歌单 / 听歌识曲）
与 Mac 端体验对齐；后台播放 + 通知栏 / 锁屏控制 / 耳机线控 / AudioFocus
全部正常。期间 v2.3.0 两项保留变更（桌面歌词位置持久化 / 打开窗口无白闪）
实机回归通过。
（拖拽校准歌词原本随 v2.3.0 出，但因 UX 不达预期已撤回，见下文「已经否过的方向」。）

## 📋 TODO

> 标记说明：`[ ]` 待做 · `[进行中]` 正在做（同时最多一条）· `[x]` 已完成 ·
> `[等 Win]` 要 Windows 才能验证 · `[阻塞]` 因其他原因卡住

- [阻塞] 实机回归：v2.3.0 PC 两项（桌面歌词关闭重开位置 / 打开无白闪）+ Android Splash UI 视觉效果（无 Android 设备）
- [ ] Android 存储层 + Cookie 桥接（`@capacitor/preferences` + `CapacitorCookies`，代码已落主线，等实机回归通过后划掉）
- [ ] Android 启动流程 + token 路由（splash → 登录 / 首页分支）
- [ ] Android 登录页 UI（账号密码 + 短信验证码，省略扫码）
- [ ] Android 后台播放 + MediaSession（通知栏 / 锁屏 / 耳机线控 / AudioFocus）
- [ ] Android 各模块 UI 重写（首页 / 歌单 / 搜索 / 播放器，按 `docs/android-design/` 设计稿）
- [ ] Android 听歌识曲 WebView 端移植（剥离 `node-shazam` 的 Node 依赖，Web Audio 重采样）
- [ ] Android Release 构建签名

## 📖 详细说明

> Android 全量任务细分见 [`docs/Android 适配 TODO.md`](../Android%20适配%20TODO.md)。这里只记当前阶段
> 的关键决策和已经否过的方向，避免下次回来重新走一遍。

### Android 存储层 + Cookie 桥接
**目标效果**：登录态、本地歌单 / 本地收藏 / Tag、搜索历史、应用设置、歌词
缓存在 Android 端持久化，杀进程不丢；`refreshCookie` 流程跑通，与 Mac 端
行为一致。

**已经做过的事**：
- 引入 `@capacitor/preferences`（package.json 已加，未提交，等本任务一起合）
- `src/platform/android.ts` 实装 `androidGetStore/SetStore/ClearStore`，
  键名 `biu:<StoreName>`，value 用 JSON 序列化。这是 Electron 端
  `electron-store` 的等价对位实现，底层换成 Android `SharedPreferences`
- 用 `CapacitorCookies` 对接 WebView 系统 cookie jar，操作对准
  `https://www.bilibili.com` 域（与 Electron 端 `electron/ipc/cookie.ts`
  用 `.bilibili.com` 域保持一致）
- `capacitor.config.ts` 同时启用 `CapacitorHttp` 和 `CapacitorCookies`
  两个插件——前者 patch 全局 fetch/XHR 让第三方库也走原生通道
- 删掉 `src/common/utils/cookie.ts` 里 `if (isAndroid) return false` 短路，
  否则 refreshCookie 永远跑不到

### v2.3.0 实机回归
**目标效果**：a45d248 / 5bef576 两项变更在真实使用下不回退。

**复现**：
- 桌面歌词位置：开桌面歌词，拖到屏幕左上角，关闭，再次打开 → 应该回到
  左上角，不是默认的底部居中
- 白闪：反复开关桌面歌词 10 次以上，每次打开的第一帧应该是透明（直接
  看到下层桌面），不是先一块白色再变透明

**已经做过的事**：
- a45d248 桌面歌词位置持久化到 `electron-store`（`windowStateStore`），
  外接屏被移除时回退到默认位置；`destroy()` 不触发 close 事件，所以在
  `destroyDesktopLyricsWindow()` 里手动 flush 一次
- 5bef576 双层修：① `src/index.html` head 阶段就根据 hash 给 `<html>`
  打 `data-transparent-window` 属性，CSS 同步把 html/body 钉为
  `transparent`，首帧就透明；② `showInactive()` 改到 `ready-to-show`
  事件里，仍是 `showInactive` 不抢焦点，对全屏游戏依然安全

**已经否过的方向**：
- a8d3363 拖拽校准歌词：按住一行拖到中央参考线松开 →
  `offset = line.time - currentTime*1000` 平移时间轴。技术上能跑，
  但 UX 不达预期（拖拽过程中 currentTime 还在前进，松手时算出来的
  offset 总是滞后 1~2 秒；视觉上拖拽态下视口冻结、活跃行不动，又跟
  播放进度脱节让人困惑）。**整体方案已撤**，下次别再走这条路；要做
  时间轴对齐换 ASR + DTW 方向，见 `docs/lyrics-alignment-spec.md`

### Android 后台播放 + MediaSession
**目标效果**：锁屏继续播放；通知栏可控制（标题 / 歌手 / 封面 / 播放暂停 /
上下首 / 进度）；耳机线控映射；切到其他 App / 来电时按 AudioFocus 规则
自动暂停 / 恢复。

**已经做过的事**：
- Electron 端用 Web `MediaSession` API，Android WebView 里同样的 API
  不可靠（后台被挂起、锁屏不响应）—— 必须接 `@capacitor-community/media-session`
- `src/platform/android.ts` 当前所有 mediaSession 方法都是 noop，移植时
  把 `audio.onplay/onpause/ondurationchange` 等事件桥接到原生 MediaSession

### Android 听歌识曲移植
**目标效果**：录音 → 指纹 → 识别全链路在 WebView 里跑通。

**已经做过的事**：
- Electron 端用 `node-shazam`（内含 `shazamio-core` WASM + Node ffmpeg），
  Android 上 Node 依赖跑不了；先验证 `node-shazam` 入口能否剥离，不行
  就降级到直接调 `shazamio-core` WASM
- WebM → 16kHz mono PCM 重采样用 Web Audio API 做，**不要**引入
  `ffmpeg.wasm`（25MB，包体不可接受）
- Android Manifest 需要加 `RECORD_AUDIO` 权限

## ✍️ 当前在做

**整个阶段搁置**：手头没有 Android 设备 / 真机，模拟器 Splash + 持久化
全链路验证都跑不起来；PC 两项的实机回归同时延期等下次集中验证窗口。
工作焦点切到 [`002-歌词时间轴对齐.md`](./002-歌词时间轴对齐.md)。

拿到 Android 设备后重启的入口动作：装一个 release apk，启动看 Splash
是否按设计稿渲染，再跑「登录 → token 写 Preferences → 杀进程重启 →
自动登录」验证存储 + cookie 桥接。
