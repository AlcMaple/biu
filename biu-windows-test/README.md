# Biu 歌词时间轴对齐 - Windows 端到端测试

回家用 Windows 跑一次完整链路：阿里云 ASR → DTW 对齐 → 输出校准后的 LRC。
**人工验证算法效果**，过了再去集成进 Biu 项目。

## 文件清单

| 文件 | 用途 |
|---|---|
| `test-wei-yi.mjs` | 单文件测试脚本，所有算法 + ASR client 内嵌，**零额外依赖** |
| `wei-yi-bad-lyrics.lrc` | 故意带错时间戳的歌词（每行 +5s 偏移） |
| `.env` | API Key 已预填，**只需填 `AUDIO_URL`** |
| `README.md` | 这个文件 |

运行后会生成：
| 文件 | 内容 |
|---|---|
| `wei-yi-asr-result.json` | 阿里云 paraformer-v2 返回的原始识别 JSON |
| `wei-yi-aligned.lrc` | DTW 校准后的最终 LRC（**这是要拿去试听的产物**） |

## Windows 上的 3 步走

### 第 1 步：把这个文件夹整个传到 Windows

整个 `biu-windows-test/` 文件夹（4 个文件，几十 KB）通过任一方式传：
- iCloud / OneDrive / 百度网盘 同步
- U 盘
- 邮件给自己

### 第 2 步：在 OSS 控制台生成《唯一》的签名 URL

1. 浏览器打开 https://oss.console.aliyun.com/
2. 进 `biu-lyrics-audio` bucket（华北 2 北京）
3. 左侧 **文件管理 → 文件列表** → 进 `audio/` 目录
4. **如果文件不在了**（24h 生命周期可能已经把它删了），先**重新上传**一次《唯一》flac
5. 点文件名，弹出详情侧栏
6. 找 **「生成下载链接」** 或 **「URL 有效期」**
7. **有效时长设 `86400`**（24 小时，避免测试期间过期）
8. 点 **「复制 URL」**

### 第 3 步：填 .env，跑脚本

用任意文本编辑器（记事本 / VS Code）打开 `.env`，把 `AUDIO_URL=` 后面的占位符
`paste-your-signed-url-here` 替换为刚复制的完整 URL（含 `?` 后所有参数）。

打开 Windows 终端（PowerShell 或 cmd 都行）：

```cmd
cd <你存放 biu-windows-test 的位置>
node --env-file=.env test-wei-yi.mjs
```

> 要求 Node 20.6+ 才支持 `--env-file`。检查 `node -v`，应该 ≥ 22.x（与 Biu 主项目一致）。

## 预期输出

脚本会逐阶段打印：

```
[1/5] 提交 ASR 任务到阿里云 paraformer-v2...     ✓ taskId: xxxxx
[2/5] 轮询任务状态（每 3 秒一次，超时 5 分钟）...
     状态: PENDING
     状态: RUNNING
     状态: SUCCEEDED
[3/5] 原始 ASR JSON 已保存到：...wei-yi-asr-result.json
     音频时长: 259.7s
     识别到: 12 句，280 个字
[4/5] 运行 DTW 对齐算法（priorCostPerSec=0.05 软先验）...
     ✓ 对齐完成
[5/5] 对齐后 LRC 已保存到：...wei-yi-aligned.lrc
```

随后逐行对比：

```
     [ar:王力宏]                                  │  [ar:王力宏]
     [ti:唯一]                                    │  [ti:唯一]
  →  [00:14.50]哦慢慢                              │  [00:09.90]哦慢慢
  →  [00:24.50]我的天空多么的清晰                  │  [00:19.50]我的天空多么的清晰
  →  [00:30.50]透明的承诺是过去的空气              │  [00:25.40]透明的承诺是过去的空气
  ...
```

`→` 标记的行 = 时间戳被算法修正过的（应该所有歌词行都被修，元数据行不动）。

## 人工验证清单

1. **元数据行原样未动**：`[ar:]` `[ti:]` `[al:]` `[by:]` `[offset:]` 应该和输入完全一致
2. **歌词行时间戳被往前拉了 ~3-4s**：因为我故意把输入做成 +5s 偏移，DTW 拉回 + `POST_OFFSET_SEC` 补偿，最终应落在真实演唱位置
3. **拿 `wei-yi-aligned.lrc` 试听**：
   - 用 VLC / 网易云 / Foobar2000 任意支持 LRC 的播放器
   - 加载《唯一》音频 + `wei-yi-aligned.lrc`
   - 看歌词是不是**跟唱准了**（每句出现的时机与人声一致）
4. **对比 `wei-yi-bad-lyrics.lrc` 试听**：
   - 同样的播放器加载错的版本
   - 应该看到歌词**慢约 5 秒**才出现

如果 3 准、4 错（如预期），算法工作正常 ✅，可以进入下一步（OSS 直传 + UI 集成）。

## 调偏移（POST_OFFSET_SEC）

试听时若歌词整体**偏早**（歌词先出现、声音才到），打开 `test-wei-yi.mjs`
顶部把 `POST_OFFSET_SEC = 1.5` 改大（比如 `2.0`）；若**偏晚**，改小（比如 `1.0`）。

> 这是 ASR 模型「音素起始」与人耳「元音峰值」的系统差，对同语言不同歌**基本恒定**，
> 校准一次后所有同类型歌都能复用。多语言场景（日韩等）目前 paraformer-v2 支持有限，
> 是另一个独立问题，不在这一阶段范围内。

重跑：

```cmd
node --env-file=.env test-wei-yi.mjs
```

第二次起会**自动复用缓存的 ASR 结果**（`wei-yi-asr-result.json`），不再消耗 DashScope 额度。
要强制重新跑 ASR（换了音频时），删除 `wei-yi-asr-result.json` 即可。

## 常见报错

| 报错 | 原因 + 修法 |
|---|---|
| `FILE_403_FORBIDDEN` | OSS 签名 URL 过期，重新生成（步骤 2） |
| `InvalidApiKey` | DashScope key 不对（重新检查 .env） |
| `Cannot find module xxx` | 路径有问题（确认 cd 到了 biu-windows-test 目录） |
| `--env-file is not a valid argument` | Node 版本太老，升级到 22.x |
| 5 分钟超时 | 阿里云队列拥堵，过会儿重试；也可能是 URL 不通 |

## 安全提醒

`.env` 含真实 API Key，**不要分享 / 不要 push 到任何 git 仓库**。`biu-windows-test/`
整个目录已经在 Biu 主项目的 `.gitignore` 屏蔽，不会进 git。

测试通过后建议：
1. 把 `.env` 删了（或清空 API Key 字段）
2. 回 macOS 在百炼控制台**重新生成 API Key 并删旧的**（这个 key 之前在聊天里贴过明文）
