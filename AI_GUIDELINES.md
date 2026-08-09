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

## 客户端与服务端的协议层

- ❌ 在 HTTP/1.1 的域名上用长轮询做实时通知
  后果：Chromium 每域名只有 6 条连接，长轮询独占一条长达 25s，同域名的其他请求会排队等它释放。（注：本项目"同步一次快一次慢"那次**不是**这个原因——真凶是限流，见下一条；但这个隐患真实存在，顺手一并消除了。）
  ✅ 长轮询/SSE 这类长连接配 HTTP/2（多路复用，不占槽位）。部署新环境或换反代时把"h2 是否协商成功"当成检查项：`curl -o /dev/null -w '%{http_version}' --http2 <url>` 应返回 2。注意 `mod_http2` 不支持 mpm_prefork，加载新模块要 `restart` 而不是 `reload`，且发行版的全局 `Protocols` 会波及同机所有站点，按 vhost 声明更稳。

- ❌ 排查"某个功能时快时慢"时，只在业务代码里找原因
  后果：真实事故——同步时快时慢查了三轮业务逻辑（防抖、连接数、协议），全是误判；真凶是反代访问日志里明晃晃的 **429**，一眼就能看到。
  ✅ **先看反代访问日志的状态码分布**（429/401/400/304），再回业务代码。一条 `grep 'your.domain' access.log | tail -60` 顶三轮猜测。

- ❌ 给自家客户端的常驻通道（长轮询/心跳）套上和普通接口一样的限流
  后果：真实事故——限流按 mid 算，两台设备共用一个账号额度；一次用户操作因请求放大会打十几个请求，几次操作就打满 60/min，之后连通知通道都被 429 拒掉，跨设备实时彻底停摆，表现为"一次快一次慢、连改几次就不动"。
  ✅ 通知通道免限流（它本身低频，被拒的代价是功能死掉）；限流只加在会被刷的数据接口上，额度按"一次用户操作实际产生多少请求 × 设备数"估，别拍脑袋定 60。排查这类问题**先看反代访问日志的状态码分布**（429/401/400/304），比在业务代码里猜快得多。

- ❌ 服务端 JSON 接口不设 `Cache-Control`
  后果：Express 的 `res.json()` 默认带 ETag，浏览器把 GET 当可缓存资源，下次带 `If-None-Match` 重新验证 → 服务端回 **304 + 空 body**，客户端拿到的是缓存副本而不是本次的真实结果。长轮询这种"每次都必须是新鲜结果"的接口尤其致命。
  ✅ 所有 API 响应统一 `Cache-Control: no-store`。

- ❌ 用 `.catch(() => null)` 吞掉常驻通道的异常
  后果：通道挂了在日志里一行痕迹都没有，只能看到"同步很慢"这种没法排查的现象，白白多花几轮定位。
  ✅ 失败必须留痕（错误内容、已挂起时长、第几次失败、下次重连间隔）。越是"平时不出声"的后台机制，越需要出事时能自证。

## 错误处理

- ❌ 统一兜底错误文案（比如所有失败都显示「网络请求失败」）
  后果：用户被限流 / PCDN 卡流时以为自己断网了，一直手动重试，反而把问题打得更狠。
  ✅ 按错误类型分类，每类给针对性文案 + 行动指引；播放类错误顺带引导「切换音质 / 重新解析」而不是笼统报错。

## 数据持久化

- ❌ 把本机绝对路径（如 `file:///C:/Users/xxx/cover.jpg`）写进要跨设备同步 / 备份的数据
  后果：本地收藏支持导出备份（见 `docs/sync/local-favorites-backup.md`），绝对路径换台设备 / 换平台就失效，封面、本地文件全裂。
  ✅ 落盘只存可移植标识（bvid、相对路径、URL），本地化路径显示时按设备现算。

- ❌ 读取 zustand persist store 的状态时不等 rehydrate 完成就当成「用户的真实数据」
  后果：**真实事故（2.5.0 云同步数据全丢）**——rehydrate 走 `platform.getStore` → IPC → 主进程读盘，是异步的；冷启动时主进程忙于建窗口/初始化，这条 IPC 排队超过同步的 800ms 防抖很正常。同步引擎拿到初始空数组，diff 出「全部条目都被删了」，把云端和本地一起清空。此前 `favorite.ts` 的 `updateCreatedFavorites` 已因同一原因出过一次事故。
  ✅ 任何「读 store 状态 → 做删除/覆盖决策」的路径，动手前必须 `await` `persist.hasHydrated()` / `onFinishHydration`（同步侧见 `SyncBinding.waitReady`，收藏夹侧见 `favorite.ts` 的 `waitForHydration`）。放宽防抖时长不算修复——那只是把赌注加大。

- ❌ 让「全量删除」这种破坏性 diff 走静默自动路径
  后果：任何一个上游 bug（状态未就绪、异常重置、解析失败）都会以「本地啥都没有」的形态出现，被如实翻译成删除指令推上云，且服务端墓碑机制会连 payload 一起丢弃，不可逆。
  ✅ 破坏性操作要有独立闸门：本地快照为空而基线非空时**拒绝推送并 `log.error`**（见 `engine.ts` 的空快照闸门）。本地数据永远是 source of truth，不同步的代价远小于删数据。

- ❌ 双向同步只在「本地有变更」时才和服务端通信
  后果：真实事故——`pullSnapshot` 只在首次迁移调过一次，之后本机没改动就直接 return，同步实际是单向的（只推不拉）。用户在另一台设备上等一天都不同步，重新登录才生效（重登重走迁移分支才拉了一次）。
  ✅ 每次同步**先拉后推**，本机无变更也要拉；再配定时 + 窗口 focus 触发。写回本地前先判断云端版本是否真的变了，否则 `setState` 会触发订阅再排一轮同步，空转不停。

- ❌ 用"操作规模"当破坏性判据（比如"一次删光就是异常"）
  后果：误伤真实用户——只有一个歌单、里面 200 首歌，整个删掉就正好是"删光全部活条目"，被拦死后这台设备之后每次同步都被拒，彻底卡住。
  ✅ 判据要用**能区分意图的信号**，不是规模。真删是「本次会话里先见过内容、现在没了」，故障是「一上来就是空的」（`witnessedNonEmpty`）。客户端确认后带 `allowFullDelete` 放行。

- ❌ 修完同步 bug 直接拿旧基线继续 diff
  后果：出过 bug 的设备本地数据和基线严重不一致，「基线有、本地没有」会被算成删除推上云，把另一台设备刚恢复的数据删掉。
  ✅ 改 `SYNC_META_EPOCH` 让旧基线作废一次，强制走一次只增不删的迁移（并集合并）。代价是曾删条目可能复活，远轻于误删。

- ❌ 服务端无条件执行客户端发来的删除指令
  后果：墓碑机制会连 payload 一起丢弃，客户端一个 bug 就能让云端数据不可逆。
  ✅ 服务端自己也要有底线：覆盖写之前把上一版存进 `{mid}/history/`（保留 10 份），并对「一批操作删光全部活条目且无新增」直接返回 409。别把「客户端会传对」当前提。

- ❌ 只留「一次性」备份（写一次就永不更新）当数据安全网
  后果：真实事故——`preMigrationBackups` 只在首次迁移那天写一次，出事时只能找回几天前的状态，之后新增的数据全部无解。
  ✅ 破坏性同步/迁移路径要留**滚动备份**（见 `src/service/sync/backup.ts`，每次推送前压入队列、保留最近 10 份），并配套可用的还原工具（`dev_tools/restore-local-playlist.mjs`）。

- ❌ 新增持久化状态时只接一端（只写 Electron 的 `electron-store`，忘了 Android）
  后果：同一份状态 Android 上不落盘，重启即丢。
  ✅ 一律走 `platform.getStore/setStore/clearStore`——Electron 落 `electron-store`，Android 落 `@capacitor/preferences`（`biu:` 前缀），两端自动通。新增 store 参考 `src/store/` 现有写法。

## UI / 样式

- ❌ 选中态 / hover 态切换时改变盒模型尺寸（只在选中态加 border、加粗字重、改 padding）
  后果：相邻元素被挤一下，出现布局抖动，chip / tab / 歌单列表项 / 播放列表高发（本项目此类组件密集）。
  ✅ 两态之间 border 宽度、字重、padding、字号、宽高必须一致，只能变颜色 / 底色 / 阴影。

- ❌ 只在“命中已配置快捷键”后释放按钮焦点；或为消除蓝色焦点圈给全项目加 `*:focus { outline: none }` / `focus-visible:outline-none`
  后果：未配置为空格的情况下，空格仍会激活鼠标刚点过的按钮并把它切成 HeroUI `data-focus-visible`；全局删轮廓则会连真正用 Tab 导航时需要的键盘焦点反馈一起删掉。
  ✅ `app.tsx` 通过 `createPointerFocusGuard()` 区分鼠标遗留焦点与 Tab 键盘焦点；capture 阶段在空格 / 回车或已配置快捷键执行前只释放前者。空格在页面背景或鼠标遗留焦点上始终作为播放器级播放 / 暂停键，焦点回到 `body` 后连续按仍须持续生效；Tab 聚焦控件时则保留该控件的原生空格操作。输入控件和 `contenteditable` 必须排除。

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
- **提交前先按 [`DEVLOG.md`](./DEVLOG.md) 的分类规则补一条日志**——专题写入 `docs/devlog/<年份>-<专题>.md`，单次改动写根文件；交付前必经步骤，不是可选项。
