# 开发日志（DEVLOG）

> **格式约定**
>
> - 每次提交前记一条：写清**这个提交做了什么、效果是什么、数据流怎么走**，让开发者扫一眼就懂，而不是复述 diff。
> - **同一功能的多次提交归到同一个二级标题（`##`）下**，各次改动用三级标题（`### 日期 type: 概述`）；同分类内**新的在上**。
> - **无需分类的单次改动**（如纯文档、杂项）直接作为二级标题（`##`）。
> - **简单改动效果足以看懂，不必展开**；**复杂功能必须配图**（数据流 / 架构），SVG 放 `docs/devlog-assets/` 并在正文引用。
> - **坑 / 反复权衡的设计决策不写这里**，归到 `docs/ideas/` 对应的 idea 文件。

## 本地歌单云同步

### 2026-08-02 feat: 本地歌单云同步

![客户端条目级合并同步到 biu-sync-server，首次同步走 diffForMigration 只增不删防丢数据](docs/devlog-assets/local-playlist-sync.svg)

**效果**：本地创建的歌单夹（`favorites`）、歌单内歌曲（`fav-items`）、标签（`tags`）三个持久化文件，此前只能靠用户自己用百度网盘同步目录做整文件同步——网盘低性能模式不实时、两端同时改动会整文件互相覆盖。现在按 B 站登录 `mid` 分用户，接一个部署在阿里云 ECS 上的轻量同步服务（`biu-sync-server/`），条目级增量合并，不再有整文件覆盖的丢数据风险。设计取舍见 [`docs/ideas/004-本地歌单云同步.md`](docs/ideas/004-本地歌单云同步.md)。已用真实账号实测：新建歌单夹 + 加两首歌后，`https://biu.alcmaple.cn` 后端 `/data/biu-sync/{mid}/` 下的 `favorites.json` / `fav-items.json` 数据与客户端一致。

## 2026-07-27 chore: 修复 Windows 下 git 提交钩子无法执行

**效果**：Windows 上 `git commit` 不再报 `cannot spawn .husky/pre-commit: Exec format error`，lint-staged / commitlint 两道门真正生效（此前钩子文件无 shebang 且被 autocrlf 检出成 CRLF，Windows 的 git 无法直接 spawn；macOS 有 ENOEXEC→sh 回退所以从未暴露）。改法：两个钩子文件补 `#!/bin/sh`，新增 `.gitattributes` 把 `.husky/*` 钉成 LF 检出，杜绝换行符复发。

## 2026-07-27 docs: 修正 CLAUDE.md 过时命令与失效引用

**效果**：对照当前仓库现状校准 CLAUDE.md——测试命令标明 `pnpm test` 是 watch 模式、CI 单次跑用 `pnpm run test -- --run`（与 AGENTS.md 上次修正对齐）；补 Lint 命令行；交叉引用 `AGENTS.md`（编码风格的事实源）；新增 `biu-windows-test/` 是一次性端到端实验目录的说明（不算入应用代码/死代码扫描）；修复两处指向不存在的 `docs/windows-setup.md` 的链接（实际为 `docs/Windows-依赖管理指南.md`）。

## 快捷键焦点反馈

### 2026-07-27 fix: 键盘操控触发导航焦点

![真实 Electron 三步验证：旧实现按空格出现蓝圈；修复后点击进入暂停；再按空格恢复播放且无蓝圈](docs/devlog-assets/focus-visible-before-after.png)

**效果**：1图是旧实现按空格后的蓝圈；2图是修复后空格进入暂停；3图是随后按空格恢复播放且无蓝圈

**关键代码**：

1. [`src/app.tsx`](src/app.tsx) 在 capture 阶段监听 `pointerdown / focusin / pointerup`，把焦点来源交给
   `createPointerFocusGuard()`；`keydown` 在 React Aria 处理前调用 `releaseForKeyDown()`。空格在页面背景或鼠标遗留焦点上始终调用播放器 `togglePlay()`，所以焦点回到 `BODY` 后连续按空格仍会持续切换；已配置快捷键释放焦点后走统一动作，不会重复触发。
2. [`src/common/utils/focus.ts`](src/common/utils/focus.ts) 只记录 pointer 期间得到焦点的非输入元素。Tab 产生的焦点不会进入
   `pointerFocusedElement`，所以正常键盘导航及其蓝色焦点提示仍保留；`input / textarea / select / contenteditable`
   继续排除。
3. [`tests/focus.test.ts`](tests/focus.test.ts) 覆盖三条边界：第一次空格释放鼠标焦点并进入播放快捷键路径；
   焦点已在 `BODY` 时后续空格仍进入同一路径；Tab 来源焦点 + 空格不走全局播放快捷键。

## 私人FM / 心动模式

### 2026-07-24 fix: 过滤新增中文听歌切片

**效果**：私人 FM 的单曲净化现在能识别未写 `reaction`、`直播` 或 `切片` 的中文听歌反应标题，例如「让日本萝莉听《派对浪客诸葛孔明》OP会有什么反应」，不再把带主播口播和评价的视频加入播放队列。

### 2026-07-17 style: 私人 FM UI重排

**效果**：

1. **控件重设计**：卡片页原有「上一首 / 播放暂停 / 下一首 / 红心」四个圆钮，前三个与底部播放栏完全重复、在此没有存在意义。改为**只留一个幽灵文字按钮**「加入我喜欢的音乐」（无边框、中性灰，不抢镜）——私人FM 的核心动作就是「收藏你喜欢的」，播放控制交给底部播放栏。文本恒定，收藏与否只体现在**文字微亮 + 心形着色**（`text-zinc-400/300` + 心形转 `#f0607a`），不做描边/填充等高对比处理。
2. **文案换行**：标题块与底部说明原本被 `max-w-md`（448px）卡着——标题过早省略号、说明那句把末尾「的」挤成第二行的孤字，而卡片区其实很宽。放宽到 `max-w-2xl` 并加 `text-balance`：说明一行放下、不再孤字，标题每行多约一半宽度、少截断。

### 2026-07-17 fix: 私人 FM 重启后接着放（会话跨重启恢复）

![私人FM 会话经 IPC 白名单落盘/取回的完整路径，之前卡在白名单缺分支](docs/devlog-assets/heartbeat-session-restart.svg)

**效果**：

1. 之前：FM 放着 → 关程序 → 过会儿重开，上次的队列还在、还能放（play-list 走 localStorage），但**它已经不是私人FM 了**——续供已死，播完只 Loop 这几十首、不再推新歌且无任何提示；点进 FM 页还会**重开一轮**把它打断。
2. 现在：重开进 FM **接着放**，播到队尾**照常续上新歌**。已推历史照旧生效，不会重复推听过的。
3. 反例不变：退出前若已点了别的歌单（队列被整队替换），重开进 FM 仍是**重开一轮**。

**做了什么**（根因/坑见 [`docs/ideas/003-私人FM.md`](docs/ideas/003-私人FM.md)）：

1. 补齐 Electron 端存储链——`electron/store.ts` 建三个 `Store` 实例、`electron/ipc/store.ts` 加 get/set/clear 分支（`HeartbeatServed / FavSeeds / Session`）。这条 IPC 白名单一直漏接，是重启不生效的真正卡点（图示）。
2. 会话落盘 `HeartbeatSession`（`start / stop / maybeTopup` 三处），主窗启动 `restoreSession()` 恢复三件套：

```ts
// store/heartbeat.ts —— 主窗 PlayBar 启动即调；FM 页挂载也 await 它再决定「接着放/重开」
export async function restoreSession() {
  if (useHeartbeat.getState().active) return;
  const { active, sessionIds } = await loadSession();
  if (!active || !sessionIds.length) return;
  const ids = new Set(sessionIds);
  if (!usePlayList.getState().list.some(it => ids.has(it.id))) {
    persistSession(false, new Set()); // 队列已被整队替换：清掉会话标记
    return;
  }
  const hist = await loadServed();
  useHeartbeat.setState({ active: true, sessionIds: ids, servedBvids: new Set(hist.bvids), servedKeys: new Set(hist.keys) }); // ①标记 ③已推历史
  attachTopup(); // ②重挂续供订阅（原本只在 start() 里挂）
}
```

### 2026-07-17 fix: 私人 FM 切走再回来不再重开一轮

**效果**：

1. 之前：FM 中点去别的歌单看看歌、再点回 FM → 清缓存 + 重置种子轮转 + 整队替换，当前这首被打断，等于每次点 FM 都从头开始。
2. 现在：**在场就接着放**；FM 中全网搜索插播过也仍算在场。
3. 原设计不变：**不在场**（从没开过 / 已被点歌单整队替换掉）才开新的一轮，仍是「进入即打断、直接开始」。

### 2026-07-15 feat: 私人FM 完善（接入网易相似表 · 切走时机 · 续供重构）

一次提交，三块：

**① feat 接入网易相似表**：候选引擎加第三条腿——网易 `simiSong` 相似歌表（IPC 五件套 `electron/ipc/api/netease-simi.ts` + `service/heartbeat/netease-similar.ts`）。候选池多了「同曲风、异歌手」跨界推荐，**默认开、无开关、失败静默、撞风控熔断**，整条挂掉只退回原效果。数据流：两道模糊匹配——去程（B站脏标题 → 网易曲目 id）+ 回程（相似歌名 → 回搜 B站单曲），排候选池最前、软超时兜底。

![Phase 2 网易腿数据流](docs/devlog-assets/netease-leg.svg)

**② fix 完善切走私人 FM 时机**：合集 / 系列两页的单曲点击接上「结束 FM + 整队替换成该歌单」，收口进 `service/heartbeat/play-from-folder.ts` 的 `playFromFolder`。数据流：单曲点击走 `playFromFolder`（按 FM 是否进行中分流）；「播放全部」靠续供订阅的会话 id 兜底自动停；全网搜索点歌仍插播、保留 FM。分P 无碍（各 item 自带其 P，按点击项旋转起点）。

![点歌来源 → 私人FM 处理](docs/devlog-assets/folder-play-switch.svg)

**③ feat 重构续供推荐歌曲功能**：续供的二度扩展种子，从「随机抽 FM 自产候选」改成「你在 FM 里收藏过的 FM 推荐歌」（`noteFavoriteFromFm` 双门槛：FM 播放中 + 收藏的歌在 `servedBvids` 里），持久化 `HeartbeatFavSeeds`；不够 3 个再从最近已推随机补齐。强正反馈闭环——FM 推、你收藏、再顺着找同类，不再漂。数据流见下方主管线图「续供 topup」面板。

### 2026-07-08 chore: 暂存

**做了什么**：仿网易云「心动模式」——从默认红心歌单取种子，用 B站原生信号找相似**单曲**，与红心歌交织、无限续供。侧栏新增「私人FM」入口 → `/heartbeat`。

**效果**：

1. **进入即自动开始播放，在播的也会被打断**。
2. 默认存在一个**不可删**的本地歌单「我喜欢的音乐」（`LIKED_FOLDER_ID = -1`），是主种子源；红心按钮把当前歌加入 / 移出它。
3. 「正在播放」卡片页：⏮上一首 / ⏯播放暂停 / ⏭下一首 / ❤️红心。红心歌跳过不算负反馈，非红心歌跳过才算。
4. **跨会话 / 跨天不重复推**：滚动记住最近 800 首已推历史，下次开 FM 自动排除。

**数据流**：红心种子（轮转覆盖全部）→ 三腿取候选（看了又看 + 同 UP，Phase 2 再加网易腿）→ 两段净化 + 去重（排除近 800 首已推）→ 交织（相似打底、插红心）→ 播放队列 → 快播完时续供（续供种子 ＝ 红心轮转 + 你在 FM 里收藏的推荐歌当二度扩展，不够则从最近已推随机补齐）。

![私人FM 数据流](docs/devlog-assets/private-fm-pipeline.svg)

## 2026-07-13 fix: 本地歌单部分歌曲播放量显示「-」

![本地歌单播放量：为什么会显示「-」、怎么补回来](docs/devlog-assets/local-fav-playcount-fix.svg)

**效果**：
1. 之前：从**播放栏星标 / 心动模式**收藏进本地歌单（如「我喜欢的音乐」）的歌，播放量一律显示「-」。
2. 现在：播放量**随歌曲一路带进播放队列**，收藏时直接沿用、**零额外请求**；个别没带到的来源异步回查一次兜底，打开歌单时再兜底补历史遗留数据。列表正常显示（如 15.1 万 / 1.2 万）。

**根因**（不是年份问题，是「播放队列把播放量丢了」）：
播放队列的 `PlayData` / `PlayItem` 类型**原本没有 `playCount` 字段**。所以哪怕搜索结果本来带着播放量，歌一进播放队列这个数就被丢掉；播放栏星标 / 心动读的是队列里的 `PlayItem`，自然拿不到，存进本地歌单就是 `undefined` → 列表按「>0 才显示，否则「-」」渲染成「-」。**不是 B 站没给，是自己的队列模型没那个槽。**

判据（翻本机存储直接可见）：`%USERPROFILE%\Documents\Biu\local-fav-items.json` 里 `source:"online"` 的项 `playCount` 全是 `null`，而从收藏夹 / 搜索页**用条目菜单**收藏的老数据 `playCount` 都正常（那条路径本来就带了播放量）。

**修法**（三层，优先级从高到低）：

**① carry-through（主，零请求）**：给 `PlayData` / `PlayItem` 加 `playCount` 字段，各播放来源构造播放项时就把播放量填进去——数据本来就在手：搜索结果 `item.play`、私人FM 候选 `SongCandidate.play`、本地歌单 `LocalFavItem.playCount`、B 站收藏夹 `cnt_info`、`getMVData` 回查元数据时顺带的 `stat.view`。收藏时 `MusicFavButton` / 心动直接读 `playItem.playCount` 存下。**私人FM 请求本来就密，这条尤其关键**——避免每次点 ❤️ 再多打一次 infos。

```ts
// store/heartbeat.ts - candToPlayItem()：私人FM 候选把 play 带进播放项
playCount: c.play,
// store/play-list.ts - getMVData()：元数据回查本就拉了 stat，顺手带上
playCount: res?.data?.stat?.view,
// components/music-fav-button：收藏时直接沿用，不再回查
itemInfo: { /* … */ playCount: playItem.playCount },
```

**② 收藏当场兜底**：**没接 carry-through 的播放入口**（历史记录 / 稍后再看 / 动态 / 投稿 / 合集等）或**来源字段本身为 0** 的项，`addOnlineItemToLocalFav` 立刻入库 + 异步回查一次 `infos` 补上。注意 `infos` 是**另一条接口**、不是重试同一份数据——收藏夹**列表**接口 `play=0` 时它照样能返回真实播放量（这正是本 bug 最初成因），所以「没带到时查 infos 也白查」不成立。（`getMVData` 已覆盖「裸 bvid 缺元数据」这类，走的是 ①，不到 ②。）

**③ 打开歌单兜底**：补历史遗留数据（本次改动前存下的 `null`）+ ② 回查失败（私密/删除/限流）的重试。搭「失效检测」的顺风车批量取播放量，零额外请求。

配套：`fav-resource-infos` 的 `cnt_info` 补 `vt?` 字段；`fillFavMediaPlayCount`（B 站收藏夹页）也改成 `resolvePlayCount(play, vt)` 两者都认。

与 B 站收藏夹页那条 `play=0` 的区别：那条是**列表接口自身**返回 0；这条是**本地队列没带 / 快照没存**。

## 2026-07-10 refactor: 重构标签筛选设计

**效果**：
1. 展开的标签浮层宽度与「标签」按钮对齐（原来是固定 252px 的浮层）。
2. 去掉每个标签右侧的全局数量。
3. 标签列表改为**只展示当前歌单内出现过的标签**——原来列出全部全局标签，2 首歌的歌单也会冒出「动漫 89 / 日系 133」等无关项；筛选本就作用于歌单内部，现在标签列表与筛选范围一致了。

**关键点**：
- **浮层同宽**：展开前量一次触发按钮的 `offsetWidth`，作为浮层 `width`。HeroUI 的 `PopoverTrigger` 内部用 `mergeRefs` 合并 ref，所以给 `Button` 挂自己的 ref 量宽度不会影响它的定位逻辑。
- **歌单内标签**：各歌单页算出 `availableTagIds`（= 歌单条目用到的标签 ∪ 当前已选）传入浮层。已选标签即便被移出歌单也保留在列表里，避免「筛完了却清不掉」；切换歌单时重置筛选，防止选择串到别的歌单。

## 2026-07-09 docs: 新增 AI_GUIDELINES.md + DEVLOG.md

**效果**：
1. 项目根目录新增两份持续维护的文档——[`AI_GUIDELINES.md`](./AI_GUIDELINES.md)（AI 生成规范 / 错题本）和本文件 `DEVLOG.md`（开发日志）。
2. 之后 AI 生成代码有明确的规范要求与避坑指南，且每次提交前都需要在本文件对改动做白盒记录。
