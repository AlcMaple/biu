# Biu Android 适配 TODO

> Android 端定位：**保留基础必要功能，不追 Electron 广度**。整体参考网易云音乐做基础体验，但**只兜 Electron 应用已有的能力**——Electron 不存在的功能不在 Android 落地。

## 技术路线（最重要的一节，动手前先读）

**Android 与 Electron 共用同一份 renderer bundle，UI 层不重写。**

`webDir: "dist/web"`（见 `capacitor.config.ts`）——Capacitor 装的就是 Electron 端那份构建产物。所以：

- **路由树只有一棵**：`src/routes.tsx`。不要按平台分叉出第二棵。
- **形态差异下沉到组件内**，Android / iOS 共用的移动形态用 `isNativeMobile` 条件渲染，真正的系统差异才用 `isAndroid` / `isIOS`：
  - `src/layout/index.tsx` — 移动端去掉常驻侧栏，改为顶栏 + 抽屉
  - `src/layout/side/index.tsx` — 侧栏在移动端变 `Drawer`
  - `src/layout/navbar/index.tsx` — 移动端顶栏（汉堡菜单 + 搜索）
  - `src/layout/playbar/mobile.tsx`、`src/components/full-screen-player/mobile.tsx` — 差异大到值得独立组件的两处
  - `src/pages/settings/index.tsx` 等 — 间距 / 尺寸微调
- **能力差异下沉到 `src/platform/`**：`mobile.ts` 对移动端无意义的能力（托盘、窗口控制、全局快捷键、更新器、桌面歌词）返回 noop，调用方无需感知。
- **Electron 独有的 UI 入口用 `isElectron` 隐藏**，不做半吊子降级实现。

### ⚠️ 已经踩过的坑：不要再按平台分叉路由树

历史上有过一次「Android UI 从零重写」的尝试（`a33f62e`）：在 `src/app.tsx` 里 `if (isAndroid) return <AndroidApp />` 早返到一棵独立路由树，配一套独立的设计 token（`android-tokens.ts`）和从零搭的屏幕组件。

结果：那棵独立路由树只做到 Splash 一屏就停了，而早返直接**架空了此前 `fbb7b9c` 已完成的全部共享组件适配**——Android 端跑起来只剩一个开屏页，歌单 / 播放器 / 搜索全部不可达。已于本次清理中撤销（删除 `src/pages/android/`、`src/common/styles/android-tokens.ts`、平台早返，以及配套的单文件 HTML 设计稿）。

教训有三条：

1. **重写 UI 的成本被严重低估**。Electron 端几十个页面 / 组件，从零搭一遍等于把项目重做，中途必然放弃，留下半成品垃圾。
2. **平行的设计 token 一定会漂移**。`android-tokens.ts` 那套硬编码色板与 HeroUI / Tailwind 主题并存，两边各改各的，深色模式尤其对不齐。要调视觉就改主题，别另起一套。
3. **同一份 renderer 还要供 Web / iOS 用**（见根 `CLAUDE.md` 的多端规划）。每分叉一个平台就多一套 UI 的话，四端就是四份屎山。

> 如果将来确实有某个屏幕移动端形态差异过大，做法是**给那个组件加平台分支或独立子组件**（照 `playbar/mobile.tsx` 的样子），而不是分叉整棵路由树。

## 不做清单（明确省略）

下列功能 Electron 端有，但 Android **有意省略**，避免后人误以为漏了：

- 桌面歌词独立窗口、迷你播放器独立窗口、系统托盘、Windows 任务栏缩略图、全局快捷键
- 下载管理
- 用户主页 / 关注、动态订阅
- 稍后再看、历史记录详情页
- **内嵌歌词显示**（B 站内嵌歌词、外部歌词搜索 / 替换均不上）
- **站内分享 / 在外部 App 分享**
- 应用自动更新、音质选择、代理设置
- 自定义封面、自定义歌手编辑、花式全屏播放器装饰
- 首页音乐推荐与排行

这些在 UI 上用 `isElectron` 隐藏入口即可，无需在 Android 侧写任何代码。

## 状态图例

| 标记 | 含义 |
|---|---|
| `[ ]` | 待办 |
| `[~]` | 进行中 |
| `[x]` | 已完成 |

---

## 零、平台基础设施

- [x] 原生移动平台抽象层（`src/platform/mobile.ts`）—— Android / iOS 共用 Capacitor 能力，无意义的返回 noop
- [x] 存储持久化 —— `@capacitor/preferences`（key 前缀 `biu:`），覆盖 token / 本地歌单 / 设置 / 歌词缓存
- [x] Cookie 桥接 —— `CapacitorCookies` 对准 `.bilibili.com`，与 `electron/ipc/cookie.ts` 对等
- [x] HTTP 跨域 —— `CapacitorHttp` 启用（同时 patch 全局 fetch/XHR），渲染端 axios 经 `src/service/request/native-adapter.ts` 走原生通道
- [x] B 站 CDN 请求 Referer 注入（`37fc190`）
- [ ] 原生层冷启动闪屏 —— `@capacitor/splash-screen`，配 Biu 品牌静态帧（纯配置，无需 React 组件）

## 一、共享 UI 的移动端适配

> 这些**不是重写**，是在共享组件里补 `isNativeMobile` 分支。改动前先在 Electron 端确认组件现状。

- [x] Layout 骨架 —— 顶栏 + 内容区 + 播放栏，侧栏改抽屉（`src/layout/index.tsx`）
- [x] 侧栏抽屉化（`src/layout/side/index.tsx`）
- [x] 移动端顶栏（`src/layout/navbar/index.tsx`）
- [x] 迷你播放栏（`src/layout/playbar/mobile.tsx`）
- [x] 全屏播放页（`src/components/full-screen-player/mobile.tsx`）
- [x] 设置页移动端布局 + 隐藏快捷键 Tab（`src/pages/settings/index.tsx`）
- [x] 歌曲列表项 / 播放队列抽屉的移动端形态
- [ ] **真机走查**：逐屏在真机上过一遍，记录触控热区过小、横向溢出、安全区（刘海 / 手势条）遮挡等问题，逐个补分支
- [ ] 下拉刷新手势同步 B 站收藏夹（Electron 端是按钮触发，移动端补手势）
- [ ] 深色模式在真机的实际表现验证（`src/store/settings.ts` 的 `themeMode`）

## 二、原生能力（Electron 不存在，必须补）

### MediaSession —— 当前唯一的阻塞性缺失

Electron 端用 Web `MediaSession` API；Android WebView 里不可靠，需 `@capacitor-community/media-session`。

- [ ] 通知栏 / 锁屏控制（标题 / 歌手 / 封面 / 播放暂停 / 上下首 / 进度）
- [ ] 状态同步到 `audio.onplay/onpause/ondurationchange`
- [ ] 耳机线控（headset hook / 媒体键映射）
- [ ] 音频焦点 —— 来电 / 其他 App 抢占时自动暂停，恢复时按需恢复（该插件通常一并处理，需验证）
- [ ] 后台存活策略验证（WebView 被系统回收时的表现）

> 这一项做完，Android 版才算「能当音乐播放器用」。优先级高于任何 UI 打磨。

### 听歌识曲移植（低优先级）

Electron 端用 `node-shazam`（内部 `shazamio-core` WASM + ffmpeg 做 WebM→WAV）；Android 需纯前端方案。

- [ ] 验证 `node-shazam` 入口能否剥离 Node 依赖；不行就直接调 `shazamio-core` WASM
- [ ] WebM → 16kHz mono PCM 重采样改用 Web Audio API（避免引入 25MB 的 ffmpeg.wasm）
- [ ] 录音权限申请（`<uses-permission android:name="android.permission.RECORD_AUDIO" />`）
- [ ] 移植完成前，识曲入口在 Android 上保持隐藏

---

## 附录：Android 平台依赖一览

| 依赖 | 用途 | 状态 |
|---|---|---|
| `@capacitor/preferences` | 登录态 / 本地歌单 / 搜索历史 / 应用设置持久化 | 已接入 |
| `@capacitor/core`（CapacitorCookies）| WebView 系统 cookie jar 桥接 | 已接入 |
| `@capacitor/core`（CapacitorHttp）| 绕过 WebView CORS 限制访问 B 站 API | 已接入 |
| `@capacitor-community/media-session` | 后台播放、通知栏、锁屏、耳机线控、音频焦点 | 待接入 |
| `@capacitor/splash-screen` | 冷启动闪屏 | 待接入 |
| `shazamio-core` | 听歌识曲 WASM 指纹库（剥离 `node-shazam` 的 Node 依赖） | 待评估 |
| Web Audio API | WebM 录音 → 16kHz mono PCM 重采样 | 待评估 |
| Android Manifest | `RECORD_AUDIO` 权限 | 随识曲一起 |

## 附录：关键路径速查

| 文件 / 目录 | 说明 |
|---|---|
| `capacitor.config.ts` | Capacitor 配置（appId / `webDir` / 插件启用 / Live Reload） |
| `android/` | Capacitor Android 工程（不进入 Windows 打包） |
| `src/platform/detect.ts` | Electron / Android / iOS / Web 原生桥判定，移动端共享 `isNativeMobile` |
| `src/platform/mobile.ts` | Android / iOS 平台能力实现（store / cookie / 其余 noop） |
| `src/platform/http-native.ts` | 原生移动端 HTTP 客户端封装 |
| `src/service/request/native-adapter.ts` | 渲染端 axios → CapacitorHttp 适配 |
| `src/layout/playbar/mobile.tsx` | 移动端迷你播放栏 |
| `src/components/full-screen-player/mobile.tsx` | 移动端全屏播放页 |
| `src/store/play-list.ts` | 播放队列 / 播放模式 / `audio.onerror` 自动跳过 |
| `src/store/settings.ts` | 主题 / 深色模式 |

## 附录：开发与调试

- 渲染层单独起：`pnpm dev:android`（设 `BIU_TARGET=android`，跳过 Electron 主进程编译）
- Live Reload 真机联调：设 `BIU_DEV_URL` 指向本机 Rsbuild dev server，见 `capacitor.config.ts`
- 构建产物同步进 Android 工程：`pnpm build:android`
- 打开 Android Studio：`pnpm open:android`
- 更多见 `docs/android/Android 调试.md`
