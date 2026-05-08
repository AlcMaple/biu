# Biu Android 适配 TODO

> Android 端定位：**保留基础必要功能，不追 Electron 广度**。整体参考网易云音乐做基础体验，但**只兜 Electron 应用已有的能力**——Electron 不存在的功能不在 Android 落地。
>
> **本轮 UI 全部重新设计**：HTML 设计稿已就位（见下"UI 参考"），Electron 端已有的实现（store / service / IPC / 平台抽象 / 业务逻辑）可以**当作功能参考**直接复用，但 UI 层（页面、组件、样式、交互）**从零搭**，不复用现有 React 组件。

## UI 参考

本轮 Android UI 严格按下面的设计稿实现：

| 文件 | 用途 |
|---|---|
| `docs/Biu_Android__.html` | 单文件 HTML 预览（内嵌 TSX，浏览器打开即可看所有屏幕） |
| `docs/android-design/*.jsx` | 设计稿源代码，每屏幕一个 `Screen*` 函数；细节按这里来 |
| `docs/android-design/biu-shared.jsx` | 设计 token（`T`）、图标（`I`）、容器（`Phone`/`TopBar`/`MiniPlaybar`/`TabBar` 等）、`Cover`/`HiResBadge`/`SourceTag` 等基础组件 |

### 视觉系统速查（来自 `biu-shared.jsx` 的 `T`）

- 主色 `#1ed760`（Spotify 绿）/ 主色文字 `#000`
- 背景 `#0a0a0a` / 表面 `#18181b` / 表面提升 `#232328`
- 文字 `#fafafa` / 次级 `#a1a1aa` / 微弱 `#71717a`
- 圆角 `rSm 8` / `rMd 12` / `rLg 16`
- 字体栈：PingFang SC → Hiragino Sans GB → Microsoft YaHei → 系统

### 全局结构

- 底部 4 Tab：**首页 / 歌单 / 搜索 / 我的**（`TabBar`）
- 多数页面底部停驻 `MiniPlaybar`（封面 + 标题 + 播放/下一首/队列 + 进度细线）
- 顶部统一 `TopBar`（`left` + `title/sub` + `right`）
- 每屏幕外层用 `Phone`（含 `StatusBar` + `NavBar`）

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

## 状态图例

| 标记 | 含义 |
|---|---|
| `[ ]` | 待办 |
| `[~]` | 进行中 |
| `[x]` | 已完成 |

---

## 零、启动流程

> 用户打开 App 第一眼看到的画面，逻辑上先于所有其他模块。
>
> **UI 参考**：`biu-base.jsx` 的 `ScreenSplash`

启动包含两层：**原生层闪屏**（WebView 还没起来时由 OS 显示静态帧，避免白屏）+ **应用层闪屏**（WebView 起来后由 React 渲染的 Biu 品牌帧，期间做 token 检查与 store hydration，再决定跳哪个屏）。

- [ ] 原生层冷启动闪屏 — `@capacitor/splash-screen`，配 Biu 品牌静态帧
- [ ] 应用层 Splash 屏（React）— 严格按 `ScreenSplash` 实现：
  - [ ] Biu Logo（绿色渐变方块 + TV+播放键 SVG）
  - [ ] 主标 "Biu"
  - [ ] 副标 "基于 Bilibili 的音乐播放器"
  - [ ] 底部版本号 + "非官方 · 仅供学习研究"（版本号从 `package.json` 注入）
- [ ] 启动路由：splash 期间检查 token 与 cookie 状态
  - [ ] 有效 token → 进首页（`ScreenHome`）
  - [ ] 无 token / token 失效 → 进登录页（`ScreenLoginPwd`）
- [ ] Splash 显示时长：等待 store hydration（Preferences 读完）+ 最短显示时间（避免一闪而过显得突兀）

---

## 一、登录与账号

> Electron 端有扫码 / 账号密码 / 短信三种登录；移动端**省略扫码**（手机扫电脑屏才合理，反过来不实用）。
>
> **UI 参考**：`biu-login.jsx` 的 `ScreenLoginPwd`（账号密码） / `ScreenLoginSms`（短信验证码）

- [ ] 登录页 UI（账号密码 + 短信验证码）  
  逻辑参考：`src/layout/navbar/login/password-login.tsx`、`code-login.tsx`、`src/store/user.ts`、`src/store/token.ts`
- [ ] Token / Cookie 持久化  
  - [ ] `@capacitor/preferences` 接入 `src/platform/android.ts` 的 `getStore/setStore/clearStore`
  - [ ] `CapacitorCookies` 桥接 WebView 系统 cookie jar，让 `platform.getCookie/setCookie` 落到原生层
  - [ ] 移除 `src/common/utils/cookie.ts` 的 `if (isAndroid) return false` 短路，跑通 refreshCookie 流程
- [ ] 退出登录 + cookie 清理（清干净 `.bilibili.com` 域 + Preferences token）

## 二、歌单模块

> **UI 参考**：`biu-playlist.jsx` 的 `ScreenPlaylistList`（列表）/ `ScreenPlaylistDetail`（详情）/ `ScreenSongMenu`（三点菜单）/ `ScreenCreatePlaylist`（新建）

### 歌单列表页

- [ ] 我的歌单总览（B 站收藏夹 + 本地收藏夹，按 Tab 区分）  
  逻辑参考：`src/pages/video-collection/`、`src/store/favorite.ts`、`src/store/local-fav-items.ts`
- [ ] 封面 / 名称 / 歌曲数 / 来源标识（B 站 / 本地）
- [ ] 下拉刷新同步 B 站收藏夹（移动端手势，Electron 端是按钮触发）

### 歌单详情页

- [ ] 封面 / 标题 / 描述 / 歌曲总数  
  逻辑参考：`src/pages/video-collection/header.tsx`
- [ ] 歌曲列表（歌名 / 歌手）
- [ ] 播放全部 / 随机播放
- [ ] 单曲点击播放
- [ ] 三点菜单：
  - [ ] 下一首播放
  - [ ] 加入其他歌单 / 移动到本地收藏夹  
    逻辑参考：`src/components/favorites-select-modal/`
  - [ ] 删除（取消收藏）
- [ ] 歌单内搜索过滤  
  逻辑参考：`src/components/search-with-sort/`

### 歌单管理

- [ ] 新建本地歌单
- [ ] 重命名 / 删除本地歌单
- [ ] 歌曲在歌单间移动 / 复制（B 站源用多选复制，本地源用移动）

## 三、播放器模块

> **UI 参考**：`biu-player.jsx` 的 `ScreenFullPlayer`（全屏播放）/ `ScreenQueueDrawer`（播放队列）/ `ScreenLockNotif`（锁屏 + 通知栏样式预览）；迷你播放栏见 `biu-shared.jsx` 的 `MiniPlaybar`

### 渲染层（UI 重新设计）

- [ ] 迷你播放栏（底部常驻：当前歌曲 + 播放/暂停 + 下一首）  
  逻辑参考：`src/layout/playbar/index.tsx`
- [ ] 全屏播放页（封面、歌名、歌手、进度条、控制按钮）  
  逻辑参考：`src/components/full-screen-player/index.tsx`
- [ ] 播放控制（播放/暂停 / 上一首/下一首 / 进度拖动）  
  逻辑参考：`src/components/music-play-control/`、`src/components/music-play-progress/`
- [ ] 四种播放模式（顺序 / 列表循环 / 随机 / 单曲循环）  
  逻辑参考：`PlayMode.Sequence / Loop / Random / Single`，`src/components/music-play-mode/`
- [ ] 播放队列查看与管理  
  逻辑参考：`src/components/music-playlist-drawer/`

### 原生层（Android 必须补，Electron 不存在）

- [ ] **后台播放 + 通知栏控制（MediaSession）**  
  Electron 端用 Web `MediaSession` API；Android WebView 里不可靠，需 `@capacitor-community/media-session`：
  - 通知栏 / 锁屏控制（标题 / 歌手 / 封面 / 播放暂停 / 上下首 / 进度）
  - 状态同步到 `audio.onplay/onpause/ondurationchange`
- [ ] 锁屏控制（MediaSession 衍生）
- [ ] 耳机线控（MediaSession 衍生：headset hook / 媒体键映射）
- [ ] 音频焦点处理 — 来电 / 其他 App 抢占音频时自动暂停，焦点恢复时按需恢复  
  通常 `@capacitor-community/media-session` 同时处理 audio focus，需验证

## 四、听歌识曲模块

> Electron 端用 Node 包 `node-shazam`（内部 `shazamio-core` WASM + ffmpeg WebM→WAV）；Android 需移植到 WebView 纯前端方案。
>
> **UI 参考**：`biu-shazam.jsx` 的 `ScreenShazamListen`（录音中）/ `ScreenShazamFound`（识别结果）/ `ScreenShazamHistory`（历史记录）

- [ ] 识曲入口 UI（首页快捷按钮 / 麦克风图标）  
  逻辑参考：`src/components/shazam-modal/`
- [ ] 录音中状态 UI（动效）
- [ ] 识别结果展示（歌曲信息、封面）
- [ ] 识别失败重试
- [ ] **WebView 端识曲底层移植**：
  - [ ] 验证 `node-shazam` 入口能否剥离 Node 依赖；不行就降级到直接调 `shazamio-core` WASM
  - [ ] WebM → 16kHz mono PCM 重采样改用 Web Audio API（避免引入 25MB 的 ffmpeg.wasm）
  - [ ] 录音权限申请（`<uses-permission android:name="android.permission.RECORD_AUDIO" />`）

## 五、搜索模块

> **UI 参考**：`biu-search.jsx` 的 `ScreenSearchEmpty`（搜索历史 + 热门）/ `ScreenSearchTyping`（输入联想）/ `ScreenSearchResults`（结果列表）

- [ ] 搜索入口 / 输入框 UI  
  逻辑参考：`src/pages/search/`、`src/components/search-button/`
- [ ] 搜索建议 / 联想  
  逻辑参考：`src/service/main-suggest.ts`
- [ ] 搜索历史 + 清空（依赖 Preferences 持久化才有意义，否则杀进程即丢）  
  逻辑参考：`src/store/search-history.ts`
- [ ] 搜索结果点击播放
- [ ] 搜索结果加入歌单  
  逻辑参考：`src/components/favorites-select-modal/`

## 六、基础体验

> **UI 参考**：`biu-base.jsx` 的 `ScreenHome`（首页）/ `ScreenEmpty`（空状态：`network` / `loading` / `empty` 三种 kind）。启动闪屏 `ScreenSplash` 见**零、启动流程**。

- [ ] 首页布局（Android 首页：搜索栏 + 歌单入口 + 识曲入口；推荐 / 排行省略）
- [ ] 网络异常 / 空状态 / 加载中占位 UI  
  逻辑参考：`src/components/empty/`
- [ ] 深色模式（系统主题感知 + Tailwind dark 类切换）  
  逻辑参考：`src/store/settings.ts` 的 `themeMode`
- [ ] 竖屏完整布局
- [ ] HTTP 跨域（B 站 API 在 WebView 里 CORS 受限）
  - [ ] CapacitorHttp 启用 + 渲染端 axios 适配  
    逻辑参考：`src/service/request/android-adapter.ts`、`src/platform/http-android.ts`
  - [ ] B 站 CDN 请求 Referer 注入  
    逻辑参考：`37fc190` commit 的实现

---

## 附录：Android 平台依赖一览

各模块涉及的 Capacitor / 原生依赖集中索引，方便分批接入：

| 依赖 | 用途 |
|---|---|
| `@capacitor/preferences` | 登录态 / 本地歌单 / 搜索历史 / 应用设置持久化 |
| `@capacitor/core`（CapacitorCookies）| WebView 系统 cookie jar 桥接 |
| `@capacitor/core`（CapacitorHttp）| 绕过 WebView CORS 限制访问 B 站 API |
| `@capacitor-community/media-session` | 后台播放、通知栏、锁屏、耳机线控、音频焦点 |
| `shazamio-core` | 听歌识曲 WASM 指纹库（直引，剥离 `node-shazam` 的 Node 依赖） |
| Web Audio API | WebM 录音 → 16kHz mono PCM 重采样 |
| `@capacitor/splash-screen` | 冷启动闪屏 |
| Android Manifest | `RECORD_AUDIO` 权限 |

## 附录：Electron 侧路径速查（功能逻辑参考用）

| 文件 / 目录 | 说明 |
|---|---|
| `src/platform/detect.ts` | `isAndroid = !navigator.userAgent.includes("Electron")`（runtime UA 判定） |
| `src/platform/android.ts` | Android 平台抽象实现（store / cookie / mediaSession / shazam 等） |
| `src/platform/http-android.ts` | Android HTTP 客户端封装 |
| `src/service/request/android-adapter.ts` | 渲染端 axios → CapacitorHttp 适配 |
| `src/store/play-list.ts` | 播放队列 / 播放模式 / audio.onerror 自动跳过 等核心逻辑 |
| `src/store/play-progress.ts` | 播放进度 |
| `src/store/local-fav-items.ts` | 本地收藏夹 |
| `src/store/favorite.ts`、`src/store/fav-folder-items.ts` | B 站收藏夹 |
| `src/store/search-history.ts` | 搜索历史 |
| `src/store/settings.ts` | 主题 / 深色模式 |
| `src/service/` | 所有 B 站 API 封装 |
| `capacitor.config.ts` | Capacitor 配置（appId / 插件启用） |
| `android/` | Capacitor Android 工程（不进入 Windows 打包） |
