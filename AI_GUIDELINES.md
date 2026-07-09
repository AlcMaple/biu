# AI 生成规范

> 本文件是「错题本 + 硬约束」，聚焦**做/不做 + 后果**；架构细节与 5 步 IPC 流程等见 [`CLAUDE.md`](./CLAUDE.md)。
> 每条格式：❌ 错误做法 → 后果 → ✅ 正确做法。踩过的坑优先落这里，不要只留一句代码注释。

## 网络请求

- ❌ 渲染进程直接用 axios 发需要 cookie / UA 伪装的 B 站请求
  后果：WebView 有 CORS，且带不上登录 cookie / 签名头，请求要么被拦要么拿到匿名结果。
  ✅ Electron 上走 main IPC（`got` v14，无 CORS 限制，见 `src/service/request/`）；Android 上走 `service/request/android-adapter.ts`（Capacitor HTTP 绕过 WebView CORS）。WBI 签名统一在 `electron/network/`。

- ❌ 选流时直接用 playurl 返回的第一个 `baseUrl`
  后果：真实事故——B 站 playurl 的 baseUrl 常是 `mcdn` / `szbdyd` 这类 PCDN 节点，Clash 等代理下会卡死/超时，表现为「能拿到流但播不动」。
  ✅ 选流优先 `upos` 域名，把 PCDN 节点降级兜底（见 memory `bilibili-pcdn-stream-stalls`）。排查播放问题第一步永远是看 `%APPDATA%\biu\logs\main.log`。

- ❌ 直接相信 `fav/resource/list` 返回的 `cnt_info.play` 当播放量
  后果：真实事故——该接口部分视频 `cnt_info.play=0`，直接展示会出现「播放量为 0」的假数据。
  ✅ 命中 0 的条目回查 `infos` 接口补全；注意区分 `vt`（新版计数）与旧 `play` 字段（见 memory `bilibili-fav-list-play-zero`）。

- ❌ 限流 / 5xx 失败后应用层自动重试、周期性探测「恢复了没」、或 catch 后静默 `return null`
  后果：惩罚窗口里加戳会加重限流；静默吞错让用户以为「没结果」而不停手动重试，等于放大伤害。
  ✅ 失败一律抛到 UI，由用户决定何时重试。唯一允许的代码层重试是传输层瞬时抖动（单次 ECONNRESET 级别），不是业务失败。

## 错误处理

- ❌ 统一兜底错误文案（比如所有失败都显示「网络请求失败」）
  后果：用户被限流 / PCDN 卡流时以为自己断网了，一直手动重试，反而把问题打得更狠。
  ✅ 按错误类型分类，每类给针对性文案 + 行动指引；播放类错误顺带引导「切换音质 / 重新解析」而不是笼统报错。

## 数据持久化

- ❌ 把本机绝对路径（如 `file:///C:/Users/xxx/cover.jpg`）写进要跨设备同步 / 备份的数据
  后果：本地收藏支持导出备份（见 `docs/local-favorites-backup.md`），绝对路径换台设备 / 换平台就失效，封面、本地文件全裂。
  ✅ 落盘只存可移植标识（bvid、相对路径、URL），本地化路径显示时按设备现算。

- ❌ 新增持久化状态时只接一端（只写 Electron 的 `electron-store`，忘了 Android）
  后果：同一份状态 Android 上不落盘，重启即丢。
  ✅ 一律走 `platform.getStore/setStore/clearStore`——Electron 落 `electron-store`，Android 落 `@capacitor/preferences`（`biu:` 前缀），两端自动通。新增 store 参考 `src/store/` 现有写法。

## UI / 样式

- ❌ 选中态 / hover 态切换时改变盒模型尺寸（只在选中态加 border、加粗字重、改 padding）
  后果：相邻元素被挤一下，出现布局抖动，chip / tab / 歌单列表项 / 播放列表高发（本项目此类组件密集）。
  ✅ 两态之间 border 宽度、字重、padding、字号、宽高必须一致，只能变颜色 / 底色 / 阴影。

## 平台抽象与 IPC

- ❌ 运行时用 `BIU_TARGET` 判断当前是不是 Android
  后果：`BIU_TARGET` 只是 Rsbuild 插件的**构建期**变量（决定跳不跳 Electron 主进程编译），运行时它不存在，判断永远错。
  ✅ 运行时平台分派一律靠 UA：`src/platform/detect.ts` 的 `isElectron = navigator.userAgent.includes("Electron")`，其余从 `src/platform/index.ts` 的 `platform` 对象取。

- ❌ 新增 IPC channel 只改一两处
  后果：类型对不上、preload 没暴露、或 Android 上调到不存在的方法直接崩。
  ✅ 五处齐改（单一事实源见 `CLAUDE.md`）：`electron/ipc/channel.ts` → `electron/ipc/<topic>.ts` handler → `electron/ipc/index.ts` 注册 → `electron/preload.ts` 暴露 → `shared/types/renderer.d.ts` 补类型。Android 也可达的话，`src/platform/android.ts` 加一条（常是 noop）以满足 Platform 类型。

- ❌ 假设 Android 平台层某个 native 能力已经通了
  后果：storage / cookie 已实现，但 Shazam、MediaSession（后台播放 / 通知 / 锁屏 / 耳机键）、字体、窗口控制、下载等**仍是 noop**，当成能用会静默无效果。
  ✅ 除 storage / cookie 外，任何 Android native 能力先当作未实现，验证过再用（见 `CLAUDE.md` Gotchas）。

## 桌面歌词窗口（严格规则）

- ❌ 桌面歌词窗构造完成后再调 `setAlwaysOnTop` / `setFocusable` / `moveTop` / `focus`
  后果：触发 `SetWindowPos` / DWM 通知，会最小化 DirectX 独占全屏游戏（LOL 等）——这是真实事故根因。
  ✅ 窗口属性只在构造时定死，之后绝不修改；Windows 上一次都不要调 `setAlwaysOnTop`。锁定态 hover 检测用 main 进程 80ms 轮询 `screen.getCursorScreenPoint()`。完整约束见 `CLAUDE.md`「Desktop lyrics window — STRICT RULE」。

## 工程习惯

- ❌ 识别出「唯一的风险是 XXX」后，只留一句注释「未来出问题再对齐 / 再修」就交付
  后果：说得出口的已知风险就是已知 bug 的候补名单，留着必然兑现，且兑现时排查成本远高于当场修。
  ✅ 识别出的风险当场消除，优先用代码根除而不是注释提醒人：能派生就不写第二份（单一事实源，物理上无法改漏），能收敛到一处就不散落两处。
  与 YAGNI 的边界：YAGNI 拒绝的是「为不存在的需求预留扩展点」；修复当下已存在的不一致、堵死已识别的失误路径，是**正确性工作**，不属于过度设计，不能拿 YAGNI 当拖延挡箭牌。

- ❌ 改动没有对应验证就说「修好了」
  后果：类型 / 单测能过不代表行为对，播放、跨窗口同步这类靠观察才知道对错。
  ✅ 有测试框架就补 / 跑测试（`pnpm test <pattern>`，Vitest + jsdom）；行为类改动要在真实窗口里驱动一遍再下结论。

## 技术栈与架构边界

- 构建用 Rsbuild + 自定义 `pluginElectron`（`plugins/`），不换 webpack / Vite——一套配置管三窗 + Android，electron-builder 配置写死在 `plugins/electron-build.ts`。
- TypeScript 5 `strict`，不关 strict、不甩 `any`——类型是唯一防线。
- UI 用 React 19 + TailwindCSS 4 + HeroUI 函数组件 + hooks，不加新 UI 库 / CSS-in-JS / class 组件——两套风格混用心智翻倍。动画统一 framer-motion。
- 状态管理用 Zustand（`src/store/`），持久化一律走 `platform.getStore/setStore`，不另起一套状态库 / 直接读写 localStorage。
- HTTP：主进程 `got` v14；渲染进程 `axios`（`src/service/request/`）；Android 走 `android-adapter`（Capacitor HTTP）。抓取需要 cookie / UA 的走 IPC，不在渲染进程裸发。
- 一份渲染 bundle 跑 3 个 Electron 窗（main / mini-player / desktop-lyrics）+ Android WebView，靠 hash route（`/`、`#mini-player`、`#desktop-lyrics`）区分；跨窗同步用 `BroadcastChannel`（渲染 ↔ 渲染）+ IPC 事件（主 ↔ 渲染），不自造第二套通道。
- 测试用 Vitest + jsdom（`tests/`，globals 开启，`tests/setup.ts` mock 了 MediaSession / audio），新测试放 `tests/`。
- 渲染进程不碰网络 / 文件 / Node API，一律走 IPC——渲染层只能请求 IPC 写死的能力，读任意文件 / 执行任意命令这种做不到，是安全边界。
- 不为不存在的需求（多租户、插件系统等）预留扩展点——YAGNI。

## 提交规范

- commit message 用 **Conventional Commits + 中文描述**：`<type>(<scope>): <描述>`（对齐仓库 `commitlint.config.mjs` 与 [`docs/Git.md`](./docs/Git.md)）。
  - type：`feat` `fix` `docs` `refactor` `perf` `style` `test` `build` `ci` `chore` `revert`
  - scope 可选，用模块名（`play-list` `ipc` `lyrics` `android` 等）；改动全局或归不到具体模块就省略。
- 标题写用户 / 开发者能看懂的**现象或结果**，不堆底层术语（术语放正文）。
  例：`fix: 修复「我喜欢的音乐」歌单选中时其他本地歌单被选中`，不是 `fix: play-list store selectedId 比较逻辑`。
- 正文按需写：简单改动只要标题；复杂 / 踩过坑的改动才写正文，正文只写关键原因 / 决策。
- **不加 AI 署名 trailer**（如 `Co-Authored-By: Claude ...`）——提交历史统一以开发者身份呈现（与现有 `git log` 一致）。
- 只在用户明确要求时才 commit / push；在默认分支上先建分支再改。
- **提交前先按 [`DEVLOG.md`](./DEVLOG.md) 的格式补一条日志**——交付前必经步骤，不是可选项。
