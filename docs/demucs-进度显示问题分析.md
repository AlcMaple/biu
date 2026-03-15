# demucs / whisperx 进度显示问题分析

## 问题现象

在运行 demucs 人声分离时，日志输出呈现两个问题：

1. **乱码**：进度条中的方块字符（`█▏▎`）显示为 `鈻堚枅鈻堚枅…`
2. **进度条无法动态更新**：每次进度变化都是独立的新行，而不是在同一行上刷新覆盖

```
11:31:07.170 > [demucs] 81%|鈻堚枅鈻堚枅鈻堚枅...| 269.0/333.4 [01:38<00:23]
11:31:09.297 > [demucs] 82%|鈻堚枅鈻堚枅鈻堚枅...| 274.9/333.4 [01:40<00:21]
```

---

## 根因分析

### 乱码原因

`█`（U+2588 FULL BLOCK）的 UTF-8 编码是 `0xE2 0x96 0x88`。

- Python subprocess 输出的是正确的 UTF-8 字节流
- Node.js 用 `d.toString("utf-8")` 读取也是正确的
- **问题出在显示端**：electron-log 写入日志文件时，或 VS Code 的 Output Panel 渲染时，将这段字节流按 GBK / Latin-1 解读，导致 `0xE2 0x96 0x88` 被错误渲染为三个 GBK 字符 `鈻堚枅`

设置 `PYTHONIOENCODING=utf-8` 和 `PYTHONUTF8=1` 只能控制 Python 进程的输出编码，**无法控制日志框架或 IDE 面板的显示编码**，因此治标不治本。

### 进度条无法动态更新的原因

tqdm 使用 `\r`（回车符，不换行）将光标移到行首，然后写入新内容，从而在真实终端中实现"原地刷新"的效果。

| 运行环境 | `\r` 行为 |
|---------|---------|
| Python 脚本直接跑在真实 TTY | 光标移到行首，下次写入覆盖同一行 ✓ |
| Electron 主进程 `process.stdout.write` | stdout 被 VS Code Extension Host 或 electron-log 捕获，**每次 write 生成独立日志条目 + 时间戳前缀**，`\r` 只是一个普通字符，无法回退已经打印的内容 ✗ |

```
Python 脚本 → 真实 TTY → tqdm \r 覆盖生效 ✓
                        └→ 终端直接渲染 UTF-8 ✓

TS subprocess → Node.js Buffer chunks
              → process.stdout.write（非 TTY 管道）
              → VS Code / electron-log 捕获
              → 每次 write = 新行 + 新时间戳 ✗
              → 日志框架可能以非 UTF-8 显示 ✗
```

### 为什么参考 Python 做法也解决不了

Python 的进度条之所以能正常工作，是因为它运行在**真实的 TTY 环境**中，终端模拟器直接处理 `\r` 指令。Electron 主进程的 `process.stdout` 不是 TTY，无论在代码层面如何模拟 tqdm 行为，都无法绕过"每次 write 被日志框架捕获并追加为新行"这一根本限制。

---

## 采用的解决方案

**通过 IPC 将进度数据发送到渲染进程，由前端 UI 组件渲染进度条。**

这是 Electron 架构下唯一可靠的方案，原因：
- 完全绕过 TTY / 编码问题——传输的是结构化数据（JSON），不是字符画
- 进度展示逻辑在 React 组件中，可以用任意 UI 框架渲染，不依赖终端特性
- 与现有 fire-and-forget IPC 模式（`syncWithWhisperXStart` / `syncWithWhisperXDone`）完全一致

### 改动清单

#### 1. `electron/ipc/channel.ts`
新增频道常量：
```ts
syncWithWhisperXProgress: "lyrics:sync-whisperx-progress"
```

#### 2. `electron/ipc/api/whisperx-sync.ts`
- 新增 `WhisperXProgressEvent` 接口：`{ stage: "download" | "demucs" | "whisperx"; pct: number }`
- `runDemucs` / `runWhisperXAlign` 增加 `onProgress?` 参数，替换原来的 `process.stdout.write`
- `syncLyricsWithWhisperX` 增加 `onProgress?` 参数并透传到各阶段：
  - **download**：通过 `got.stream` 的 `downloadProgress` 事件上报
  - **demucs**：解析 tqdm stderr 的百分比，每 1% 触发一次（每 10% 写一条 log）
  - **whisperx**：同上

#### 3. `electron/ipc/lyrics.ts`
在 `syncWithWhisperXStart` 的 IPC 处理器中，创建 `onProgress` 回调，通过 `event.sender.send` 推送进度事件到渲染进程。

#### 4. `shared/types/renderer.d.ts`
在 `ElectronAPI` 中新增：
```ts
onSyncLyricsWithWhisperXProgress: (
  cb: (progress: { stage: "download" | "demucs" | "whisperx"; pct: number }) => void,
) => VoidFunction;
```

#### 5. `electron/preload.ts`
通过 `contextBridge` 暴露 `onSyncLyricsWithWhisperXProgress`，返回取消订阅函数。

#### 6. `src/components/lyrics-search-modal/lyrics-preview-modal.tsx`
- 新增 `syncProgress` state，在 `isSyncing` 期间展示 HeroUI `<Progress>` 组件
- 阶段标签：`download` → 下载音频，`demucs` → 人声分离，`whisperx` → 歌词对齐
- 同步完成或失败时重置 `syncProgress` 为 `null`

---

## 遗留问题

### 乱码是否彻底解决？

**是的。** 新方案中：
- 进度不再经过 `process.stdout.write` 或 `log.info`（百分比数字），因此不再有任何字符画输出
- log 文件中仍会在每 10% 时写入纯 ASCII 的 `[demucs] 40%`，不含任何 Unicode 方块字符，不会乱码
- tqdm 的原始 stderr 只在非百分比行时才调用 `log.info`（模型加载提示等纯 ASCII 信息）

### 如果未来需要在终端显示友好进度（如 CLI 模式）

可以在调用 `syncLyricsWithWhisperX` 时传入一个写 `process.stdout` 的 `onProgress`，但必须：
1. 确认运行环境是真实 TTY（`process.stdout.isTTY === true`）
2. 只在 CLI 入口使用，Electron 环境下保持使用 IPC 方案
