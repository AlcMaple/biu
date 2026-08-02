# 歌词时间轴对齐 - 技术实现文档

## 0. 目标

- **输入**：MP3/WAV 等音频文件 + LRC 文本（**可能含不准时间戳**，也可能含元数据行如 `[ar:xxx]` / 纯时间戳无内容的间奏标记）
- **输出**：标准 LRC 文件（每行带 `[mm:ss.xx]` 时间戳；输入里的元数据行原样保留）
- **约束**：纯 TypeScript / JavaScript，可在 Electron / Node.js 环境运行；服务端只做轻量代理
- **优先级**：速度 + 质量，不可破坏 API Key 安全（不能下发到客户端）

## 1. 总体思路

国内云 API 没有"传歌词+音频直接返回 LRC"的现成接口，所以必须自己组合：

```
[音频文件] ──→ [阿里云 fun-asr] ──→ [带字级时间戳的识别文本]
                                              │
                                              ↓
[LRC 输入] ──→ [parseLrc 拆元数据/歌词] ──→ [DTW 对齐] ──→ [按行回填时间戳 + 元数据原样写回] ──→ [LRC]
                                            ↑
                              (旧时间戳可选作软先验)
```

**核心 trick**：ASR 识别可能听错字（尤其是歌曲），但**时间戳是准的**。所以拿"真实歌词字符序列"和"ASR 字符序列"做 DTW 最优匹配，把每个真实字符借用最匹配的 ASR 字符的时间戳。即使有少量识别错误，对齐质量也不掉。

**为什么输入改成 LRC 而不是纯文本**：
- 用户已有的歌词通常就是 LRC 格式（从网易云 / LrcLib / B 站抓的），只是时间戳不准；让他们去掉时间戳再喂进来既麻烦也丢信息
- 原 LRC 里的 `[ar:]` `[ti:]` `[al:]` `[by:]` 等元数据行有保留价值（生成的新 LRC 不应该丢这些）
- **旧时间戳虽然不准但能当软先验**：DTW 代价里加一项"与原时间戳偏离"的轻微惩罚，能在 ASR 识别质量边缘时把对齐拉回正轨

## 2. 为什么选阿里云 fun-asr

| 候选 | 评价 |
|---|---|
| **阿里云 fun-asr**（首选） | 阿里达摩院最新模型，**明确支持歌唱识别（带 BGM 整首歌曲转写）**，字级时间戳精度高，REST API，国内可直接访问 |
| 阿里云 paraformer-v2 | 同家但不专门做歌曲，可作 fallback |
| 讯飞语音转写 | 价格贵，对歌曲场景没有专门优化 |
| 腾讯云录音文件识别 | 字级时间戳支持但歌曲识别率一般 |
| OpenAI Whisper API | 需要魔法，pass |

fun-asr 的"歌唱识别"是关键能力，省去了客户端做 Demucs 人声分离的所有麻烦。

## 3. 架构

```
┌─────────────┐        ┌──────────┐         ┌──────────────────┐
│  Electron   │───1───▶│  阿里云  │         │   你的服务器     │
│   (用户)    │  直传  │   OSS    │         │  (轻量 Node 代理)│
│             │◀──2───-│ (临时桶) │         │                  │
│             │ 返回URL│          │         │                  │
│             │───────────3──────────────-▶│                  │
│             │      传 OSS URL + 歌词        │                  │
│             │                              │────4───────────▶│
│             │                              │  转发给 fun-asr  ▼
│             │                              │            ┌──────────┐
│             │                              │            │  阿里云  │
│             │                              │◀───5──────│ fun-asr  │
│             │                              │   带时间戳  └──────────┘
│             │                              │   识别结果
│             │◀──────────6──────────────────│
│             │      返回 ASR 结果 JSON
│             │
│  ▶ 本地 DTW 对齐 + 生成 LRC（7）
└─────────────┘
```

**为什么音频直传 OSS 而不是经过服务器**：
- 一首 mp3 5-10 MB，经服务器中转会占带宽和磁盘
- OSS 直传性能更好，安全性可控（用 STS 临时凭证）
- 你的服务器只处理小 JSON 请求，1GB 内存绰绰有余

## 4. 阿里云 fun-asr API 完整规格

文档：<https://help.aliyun.com/zh/model-studio/recording-file-recognition>

### 4.1 提交转写任务

```http
POST https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription

Headers:
  Authorization: Bearer ${DASHSCOPE_API_KEY}
  Content-Type: application/json
  X-DashScope-Async: enable

Body:
{
  "model": "fun-asr",
  "input": {
    "file_urls": ["https://your-bucket.oss-cn-beijing.aliyuncs.com/audio/xxx.mp3"]
  },
  "parameters": {
    "language_hints": ["zh", "en"]
  }
}
```

返回（立即返回 task_id，不等结果）：

```json
{
  "output": {
    "task_status": "PENDING",
    "task_id": "c2e5d63b-96e1-4607-bb91-xxxxxxxx"
  },
  "request_id": "..."
}
```

### 4.2 查询任务结果

```http
GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}

Headers:
  Authorization: Bearer ${DASHSCOPE_API_KEY}
```

返回（任务完成时）：

```json
{
  "output": {
    "task_status": "SUCCEEDED",
    "results": [
      {
        "file_url": "https://...",
        "transcription_url": "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/xxx.json?...",
        "subtask_status": "SUCCEEDED"
      }
    ]
  }
}
```

`task_status` 可能值：`PENDING` / `RUNNING` / `SUCCEEDED` / `FAILED`

### 4.3 拿真正的识别结果

注意：`transcription_url` 是一个临时签名 URL，需要**再 GET 一次**才能拿到真正的识别 JSON：

```http
GET ${transcription_url}
```

返回（核心结构）：

```json
{
  "file_url": "...",
  "properties": {
    "audio_format": "...",
    "original_sampling_rate": 16000,
    "original_duration_in_milliseconds": 240000
  },
  "transcripts": [
    {
      "channel_id": 0,
      "text": "完整识别文本...",
      "sentences": [
        {
          "begin_time": 760,
          "end_time": 3240,
          "text": "句子文本",
          "sentence_id": 1,
          "words": [
            {
              "begin_time": 760,
              "end_time": 1000,
              "text": "字或词",
              "punctuation": ""
            }
            // ...
          ]
        }
        // ...
      ]
    }
  ]
}
```

**关键字段**：`transcripts[0].sentences[].words[]`，每个 word 是一个字或词（中文一般是单字，英文是单词），带 `begin_time` 和 `end_time`（毫秒）。

### 4.4 错误处理要点

- 提交任务后必须**轮询**，不要假设瞬时完成。建议间隔 2-3 秒，超时上限 5 分钟
- 一次提交可以传多个 file_urls，但我们用单文件模式即可
- 文件大小上限 2GB，时长上限 12 小时——歌曲场景完全够
- 仅接受公网 URL，不支持二进制流或本地路径上传

## 5. 服务端实现（Node.js + TypeScript）

服务端只负责：
1. 接收客户端的 `{ fileUrl, lyrics }` 请求
2. 调用 fun-asr 提交任务
3. 提供任务状态查询接口
4. （可选）生成 OSS STS 临时凭证给客户端做直传

### 5.1 核心代理接口

```typescript
import axios from 'axios';

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY!;
const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1';

// POST /api/transcribe
// body: { fileUrl: string, languageHints?: string[] }
// resp: { taskId: string }
export async function submitTranscription(
  fileUrl: string,
  languageHints: string[] = ['zh', 'en'],
): Promise<string> {
  const resp = await axios.post(
    `${DASHSCOPE_BASE}/services/audio/asr/transcription`,
    {
      model: 'fun-asr',
      input: { file_urls: [fileUrl] },
      parameters: { language_hints: languageHints },
    },
    {
      headers: {
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
    },
  );
  return resp.data.output.task_id;
}

// GET /api/transcribe/:taskId
// resp:
//   { status: 'PENDING' | 'RUNNING' }
//   { status: 'SUCCEEDED', result: AsrResult }
//   { status: 'FAILED', error: string }
export async function queryTranscription(taskId: string) {
  const resp = await axios.get(`${DASHSCOPE_BASE}/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
  });

  const output = resp.data.output;
  const status = output.task_status;

  if (status === 'SUCCEEDED') {
    const transcriptionUrl = output.results[0].transcription_url;
    const resultResp = await axios.get(transcriptionUrl);
    return { status: 'SUCCEEDED', result: resultResp.data };
  } else if (status === 'FAILED') {
    return { status: 'FAILED', error: output.message ?? 'unknown error' };
  } else {
    return { status }; // PENDING / RUNNING
  }
}
```

### 5.2 STS 临时凭证接口（可选但推荐）

如果客户端直传 OSS，需要服务端发临时凭证，避免下发主账号 AK/SK。

```typescript
import { Sts } from 'ali-oss';

// GET /api/oss/sts
// resp: { accessKeyId, accessKeySecret, securityToken, expiration }
export async function getStsToken() {
  const sts = new Sts({
    accessKeyId: process.env.OSS_RAM_AK!,
    accessKeySecret: process.env.OSS_RAM_SK!,
  });
  
  const policy = {
    Version: '1',
    Statement: [{
      Action: ['oss:PutObject'],
      Effect: 'Allow',
      Resource: ['acs:oss:*:*:your-bucket/audio/*'],
    }],
  };
  
  const result = await sts.assumeRole(
    'acs:ram::ACCOUNT_ID:role/your-role-name',
    policy,
    900, // 15 分钟有效
    'lyrics-aligner',
  );
  
  return {
    accessKeyId: result.credentials.AccessKeyId,
    accessKeySecret: result.credentials.AccessKeySecret,
    securityToken: result.credentials.SecurityToken,
    expiration: result.credentials.Expiration,
  };
}
```

## 6. 客户端实现（Electron Renderer/Main + TypeScript）

### 6.1 上传音频到 OSS

```typescript
import OSS from 'ali-oss';
import path from 'node:path';

export async function uploadAudioToOss(localAudioPath: string): Promise<string> {
  // 1. 找服务器拿 STS 临时凭证
  const sts = await fetch('https://your-server/api/oss/sts').then(r => r.json());
  
  const client = new OSS({
    accessKeyId: sts.accessKeyId,
    accessKeySecret: sts.accessKeySecret,
    stsToken: sts.securityToken,
    region: 'oss-cn-beijing',
    bucket: 'your-bucket',
    secure: true,
  });

  const objectKey = `audio/${Date.now()}_${path.basename(localAudioPath)}`;
  const result = await client.put(objectKey, localAudioPath);
  return result.url;
}
```

### 6.2 提交并轮询识别任务

```typescript
export async function transcribeAndWait(audioUrl: string): Promise<AsrResult> {
  const submitResp = await fetch('https://your-server/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileUrl: audioUrl }),
  }).then(r => r.json());

  const taskId = submitResp.taskId;
  const deadline = Date.now() + 5 * 60 * 1000; // 5 分钟超时

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    
    const q = await fetch(`https://your-server/api/transcribe/${taskId}`)
      .then(r => r.json());
    
    if (q.status === 'SUCCEEDED') return q.result;
    if (q.status === 'FAILED') throw new Error(q.error);
    // PENDING / RUNNING -> 继续等
  }
  
  throw new Error('Transcription timeout');
}
```

### 6.3 解析 LRC 输入（**新增**）

输入是 LRC 文本，需要先拆出「元数据行 / 歌词行」。元数据行（ID 标签、纯时间戳无内容的间奏标记、空行）跳过对齐，输出时按 `raw` 字段原样写回；歌词行带上 `priorTime`（旧时间戳）参与对齐。

```typescript
export type LrcParsedLine =
  | { type: "metadata"; raw: string }                         // 元数据 / 间奏标记 / 空行
  | { type: "lyric"; raw: string; text: string; priorTime?: number }; // 歌词行

const ID_TAG_RE = /^\[(ar|ti|al|by|offset|re|ve|au|la|length):/i;
const TIME_TAG_RE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

function parseTimeTag(tag: string): number | undefined {
  // tag: "[mm:ss.xx]" 或 "[mm:ss:xx]"
  const m = tag.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]$/);
  if (!m) return undefined;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  // 兼容 2 位 / 3 位毫秒部分：[00:12.34] = 340ms；[00:12.345] = 345ms
  const fracStr = m[3] ?? "0";
  const frac = Number(fracStr.padEnd(3, "0").slice(0, 3));
  return min * 60_000 + sec * 1000 + frac;
}

export function parseLrc(lrcText: string): LrcParsedLine[] {
  const result: LrcParsedLine[] = [];
  for (const raw of lrcText.split(/\r?\n/)) {
    const trimmed = raw.trim();

    // 空行 / ID 标签 → metadata 透传
    if (!trimmed || ID_TAG_RE.test(trimmed)) {
      result.push({ type: "metadata", raw });
      continue;
    }

    // 提取所有时间戳前缀
    const tags = trimmed.match(TIME_TAG_RE) ?? [];
    const text = trimmed.replace(TIME_TAG_RE, "").trim();

    if (tags.length === 0) {
      // 没有时间戳但有内容：当歌词，priorTime 留空（DTW 走纯字符匹配）
      result.push({ type: "lyric", raw, text: trimmed });
      continue;
    }

    if (!text) {
      // 纯时间戳无内容 → 间奏标记，按 metadata 透传（保留原始 raw）
      result.push({ type: "metadata", raw });
      continue;
    }

    // 一行可能有多个时间戳前缀（同一句重复时间标记），用第一个作为 priorTime
    const priorTime = parseTimeTag(tags[0]);

    // 同一句多个时间戳 → 拆成多条歌词行（罕见，但 LRC 规范允许）
    if (tags.length > 1) {
      for (const tag of tags) {
        result.push({
          type: "lyric",
          raw: `${tag}${text}`,
          text,
          priorTime: parseTimeTag(tag),
        });
      }
    } else {
      result.push({ type: "lyric", raw, text, priorTime });
    }
  }
  return result;
}
```

**为什么有 raw 字段**：元数据行可能格式各异（`[ar:周杰伦]` `[offset:+200]` 甚至非标准 `[mood:...]`），用 `raw` 原样保留比"识别 + 重建"稳。

### 6.4 DTW 对齐核心算法（**重点，完整实现**）

```typescript
interface AsrWord {
  text: string;
  begin_time: number;
  end_time: number;
}

interface AsrChar {
  char: string;
  time: number; // 该字符开始时间，毫秒
}

/**
 * 把 ASR 词级时间戳展开为字符级时间戳。
 * fun-asr 中文一般每个 word 就是一个字，但也可能是词（如"阿里巴巴"），需要均分时长。
 * 英文一个 word 是一个单词，按整体处理，不拆字母。
 */
export function expandAsrToChars(words: AsrWord[]): AsrChar[] {
  const result: AsrChar[] = [];
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    
    // 判断是否为纯英文/数字（按 word 整体处理）还是中文（按字拆分）
    if (/^[a-zA-Z0-9'\-]+$/.test(text)) {
      result.push({ char: text.toLowerCase(), time: w.begin_time });
    } else {
      // 拆成单字
      const chars = Array.from(text).filter(c => c.trim());
      if (chars.length === 0) continue;
      const dur = (w.end_time - w.begin_time) / chars.length;
      chars.forEach((c, i) => {
        result.push({ char: c, time: w.begin_time + i * dur });
      });
    }
  }
  return result;
}

/**
 * 字符相似度评分（0 = 完全匹配，1 = 完全不匹配）。
 * 简化版：只看是否相等。
 * 进阶可以扩展为拼音相似度或编辑距离。
 */
function charCost(a: string, b: string): number {
  if (a === b) return 0;
  if (a.toLowerCase() === b.toLowerCase()) return 0.1; // 大小写差异
  return 1;
}

/**
 * 真实字符 + 可选先验时间戳（来自原 LRC 行）。
 * priorTime 来自 parseLrc 输出的 lyric 行的 `priorTime` 字段；
 * 同一行内所有字符共享该行的 priorTime。
 */
export interface RealChar {
  char: string;
  priorTime?: number; // 毫秒，来自旧 LRC 的行时间戳；undefined 表示无先验
}

/**
 * 用 DTW（动态时间规整）把真实歌词字符对齐到 ASR 字符。
 * 关键设计：
 *   - dp[0][j] = 0：允许 ASR 序列开头任意跳过（前奏 / 间奏）
 *   - 末尾选 dp[m][bestJ]：允许 ASR 序列末尾任意跳过（尾奏）
 *   - 插入 ASR 字符代价 < 删除真实字符代价：宁可让 ASR 多识别也不漏真实字符
 *   - 可选「时间先验软惩罚」：若真实字符带 priorTime，匹配 ASR 字符时
 *     按 |priorTime - asrTime| / 1000 * PRIOR_COST_PER_SEC 加分。
 *     默认 0.05/s —— 1 秒偏差只加 0.05 分，远低于字符不匹配的 1 分；
 *     但 ASR 识别错乱时（比如把第 2 段误识到第 1 段位置），先验能
 *     把对齐拉回大致正确的时间窗。
 *
 * 返回：长度为 realChars.length 的数组，每个元素是对应 ASR 字符的索引，或 null 表示未匹配。
 */
export function dtwAlign(
  realChars: RealChar[],
  asrChars: AsrChar[],
  options: { priorCostPerSec?: number } = {},
): (number | null)[] {
  const m = realChars.length;
  const n = asrChars.length;
  const PRIOR_COST_PER_SEC = options.priorCostPerSec ?? 0.05;

  // dp[i][j] = 前 i 个真实字符匹配前 j 个 ASR 字符的最小代价
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(Infinity),
  );
  // 关键：允许 ASR 开头跳过任意字符
  for (let j = 0; j <= n; j++) dp[0][j] = 0;

  // 转移
  const INSERT_COST = 0.3;  // ASR 多了字符（罚分轻）
  const DELETE_COST = 1.2;  // 真实字符没找到（罚分重）

  // 匹配代价：字符相似度 + 可选的时间先验偏离惩罚
  const matchCost = (real: RealChar, asr: AsrChar): number => {
    const c = charCost(real.char, asr.char);
    if (real.priorTime === undefined || PRIOR_COST_PER_SEC === 0) return c;
    return c + (Math.abs(real.priorTime - asr.time) / 1000) * PRIOR_COST_PER_SEC;
  };

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = matchCost(realChars[i - 1], asrChars[j - 1]);
      dp[i][j] = Math.min(
        dp[i - 1][j - 1] + c,         // 匹配
        dp[i - 1][j] + DELETE_COST,   // 跳过真实字符
        dp[i][j - 1] + INSERT_COST,   // 跳过 ASR 字符
      );
    }
  }

  // 末尾选最优终止点（允许 ASR 末尾跳过）
  let bestJ = n;
  for (let j = 0; j <= n; j++) {
    if (dp[m][j] < dp[m][bestJ]) bestJ = j;
  }

  // 回溯
  const mapping: (number | null)[] = new Array(m).fill(null);
  let i = m;
  let j = bestJ;
  while (i > 0 && j > 0) {
    const c = matchCost(realChars[i - 1], asrChars[j - 1]);
    if (Math.abs(dp[i][j] - (dp[i - 1][j - 1] + c)) < 1e-9) {
      mapping[i - 1] = j - 1;
      i--;
      j--;
    } else if (Math.abs(dp[i][j] - (dp[i - 1][j] + DELETE_COST)) < 1e-9) {
      i--;
    } else {
      j--;
    }
  }

  return mapping;
}

/**
 * 把未匹配位置的时间戳用线性插值填上。
 */
export function interpolateNulls(
  mapping: (number | null)[],
  asrChars: AsrChar[],
  audioDurationMs: number,
): number[] {
  const times: (number | null)[] = mapping.map(idx =>
    idx === null ? null : asrChars[idx].time,
  );

  const result = times.slice() as (number | null)[];
  
  // 头部：如果开头几个是 null，用 0 或第一个非 null 时间
  let firstNonNull = result.findIndex(t => t !== null);
  if (firstNonNull > 0) {
    const firstTime = result[firstNonNull] as number;
    for (let i = 0; i < firstNonNull; i++) {
      result[i] = (firstTime * i) / firstNonNull;
    }
  } else if (firstNonNull === -1) {
    // 完全没匹配上，整体均分（异常情况）
    return result.map((_, i) => (audioDurationMs * i) / result.length);
  }

  // 中间：在两个锚点之间线性插值
  let i = 0;
  while (i < result.length) {
    if (result[i] !== null) {
      i++;
      continue;
    }
    let next = i + 1;
    while (next < result.length && result[next] === null) next++;
    
    const prevTime = result[i - 1] as number;
    const nextTime = next < result.length 
      ? (result[next] as number) 
      : audioDurationMs;
    const steps = next - (i - 1);
    
    for (let k = i; k < next; k++) {
      result[k] = prevTime + ((nextTime - prevTime) * (k - (i - 1))) / steps;
    }
    i = next;
  }

  return result as number[];
}
```

### 6.5 生成 LRC（按行回填 + 元数据透传）

`buildLrc` 不再按字符散装时间戳，而是**按行**：每行用「该行第一个字符的修正时间戳」作为整行的时间戳。元数据行（含纯时间戳无内容的间奏标记）走 `raw` 字段原样写回，避免把 `[ar:周杰伦]` 这种东西误改。

```typescript
function formatLrcTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const min = Math.floor(safe / 60000);
  const sec = Math.floor((safe % 60000) / 1000);
  const cs = Math.floor((safe % 1000) / 10);
  return `[${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}]`;
}

function isPunctuation(c: string): boolean {
  return /[\s\p{P}]/u.test(c);
}

/**
 * 按行回填时间戳生成 LRC。
 * - 元数据行（含间奏标记、空行、ID 标签）按 raw 原样写回。
 * - 歌词行：取该行第一个参与对齐字符的修正时间戳作为该行时间戳，
 *   text 保留原标点和空白。
 *
 * @param parsedLines parseLrc 的输出
 * @param charTimes   字符级修正时间戳数组，长度 = 所有 lyric 行过滤标点 / 空白后的字符总数
 */
export function buildLrc(parsedLines: LrcParsedLine[], charTimes: number[]): string {
  const out: string[] = [];
  let charIdx = 0;

  for (const line of parsedLines) {
    if (line.type === "metadata") {
      out.push(line.raw);
      continue;
    }

    const lineChars = Array.from(line.text).filter(c => c.trim() && !isPunctuation(c));

    if (lineChars.length === 0) {
      // 一整行全是标点 / 空白 → 不参与对齐，按 raw 原样写
      out.push(line.raw);
      continue;
    }

    // 取该行第一个字符的修正时间戳作为整行时间戳
    const lineTime = charTimes[charIdx];
    if (lineTime !== undefined) {
      out.push(`${formatLrcTime(lineTime)}${line.text}`);
    } else {
      // 对齐异常时 fallback 到 raw（保留旧时间戳总比丢了好）
      out.push(line.raw);
    }
    charIdx += lineChars.length;
  }

  return out.join("\n");
}
```

**为什么按行而不按字符**：
- 行级 LRC 是绝大多数播放器（包括 Biu）唯一支持的格式
- 字符级时间戳之间会有正常的演唱节奏抖动；只取第一个字符的时间戳能避免把行内抖动错误地放大成行间偏移
- 卡拉 OK 模式（每字一个内联时间戳）见第 10.1 节，是可选增强

### 6.6 主流程整合

```typescript
export async function alignLyrics(
  audioPath: string,
  lrcText: string,
  options: { priorCostPerSec?: number } = {},
): Promise<string> {
  // 1. 解析 LRC 输入：分离元数据行 / 歌词行，歌词行携带旧时间戳作软先验
  const parsedLines = parseLrc(lrcText);

  // 2. 上传到 OSS
  const audioUrl = await uploadAudioToOss(audioPath);

  // 3. ASR 识别
  const asrResult = await transcribeAndWait(audioUrl);

  // 4. 提取 ASR 字符序列
  const allWords: AsrWord[] = asrResult.transcripts[0].sentences.flatMap(
    (s: any) => s.words,
  );
  const asrChars = expandAsrToChars(allWords);

  // 5. 提取真实字符序列（标点 / 空白过滤；priorTime 来自所在行）
  const realChars: RealChar[] = [];
  for (const line of parsedLines) {
    if (line.type !== "lyric") continue;
    const chars = Array.from(line.text).filter(c => c.trim() && !isPunctuation(c));
    for (const c of chars) {
      realChars.push({ char: c, priorTime: line.priorTime });
    }
  }

  // 6. DTW 对齐（带可选时间先验软惩罚）
  const mapping = dtwAlign(realChars, asrChars, options);

  // 7. 填充未匹配的时间戳
  const audioDuration = asrResult.properties.original_duration_in_milliseconds;
  const charTimes = interpolateNulls(mapping, asrChars, audioDuration);

  // 8. 按行回填生成 LRC（元数据原样保留）
  return buildLrc(parsedLines, charTimes);
}
```

**`priorCostPerSec` 调参建议**：
- `0`：完全忽略旧时间戳，纯字符匹配（输入 LRC 时间戳极烂时用）
- `0.05`（默认）：1 秒偏差只多 0.05 分代价，远小于字符不匹配的 1 分。日常默认
- `0.2 ~ 0.5`：强先验，旧时间戳基本可信但要小幅修正时用

## 7. 边界情况与处理

### 7.1 真实歌词的标点和空白
- 对齐时**必须过滤**所有标点和空白字符（中英文标点都要处理）
- 但 LRC 输出时**保留原样**（包括逗号、句号等）—— `buildLrc` 用 `line.text` 整段写回
- `isPunctuation` 用 Unicode 属性 `\p{P}` 匹配所有标点

### 7.2 LRC 元数据行 / 间奏标记
- `[ar:周杰伦]` / `[ti:Mojito]` / `[al:周杰伦的床边故事]` / `[by:xxx]` / `[offset:+200]` 等 ID 标签：`parseLrc` 识别为 metadata，原样透传到输出
- 纯时间戳无内容的间奏标记（如 `[01:23.45]`）：同样按 metadata 处理，保留原 raw
- 空行：保留原样（间奏分隔）
- 非标准的扩展标签（`[mood:happy]` 等）：fallback 按 metadata 透传

### 7.3 旧时间戳精度差异
- LRC 规范允许 2 位 / 3 位毫秒部分（`[00:12.34]` = 340ms 或 `[00:12.345]` = 345ms）
- `parseTimeTag` 用 `padEnd(3, "0").slice(0, 3)` 统一到 3 位
- 偶尔见到 `[00:12:34]`（分号变冒号）—— 同样接受

### 7.4 副歌重复
- 如果歌词文本里副歌只写了一遍，但歌曲实际唱了 N 遍：DTW 会把第一遍对齐，后面对应不上
- 解决：**要求用户提供与音频实际播放一致的完整展开歌词**
- 进阶（可选）：检测识别文本中的重复段落，自动补齐歌词
- 软先验帮忙：如果用户输入的 LRC 已经按音频实际顺序展开但时间戳错位，`priorCostPerSec` 能把对齐拉到正确的时间窗

### 7.5 前奏 / 间奏 / 尾奏
- DP 边界条件 `dp[0][j] = 0` 和末尾选 `bestJ` 自动处理前后奏
- 中间间奏会通过 ASR "听不到歌词"自然跳过

### 7.6 多语言混合
- `language_hints: ['zh', 'en']` 已经覆盖中英混合
- 日语、韩语歌曲加对应代码 `['ja']` / `['ko']`

### 7.7 ASR 把多个字识别为一个 word
- fun-asr 中文偶尔会返回多字词（如"阿里巴巴"），`expandAsrToChars` 已按时长均分处理

### 7.8 任务失败重试
- ASR 任务失败（FAILED）：检查 OSS URL 是否公网可访问、音频格式是否合法
- 网络超时：默认重试 1 次
- 5 分钟仍 PENDING：通常是阿里云队列拥堵，建议给用户提示而不是无限等

## 8. 性能与成本

**单首 4 分钟流行歌**：

| 阶段 | 时间 | 备注 |
|---|---|---|
| 上传到 OSS | 2-5s | 取决于用户网速 |
| 提交任务 | < 1s | |
| ASR 排队 + 识别 | 15-60s | 通常 30s 内 |
| DTW + LRC 生成 | < 100ms | 纯本地计算 |
| **端到端** | **30-90s** | |

**单次成本**：
- fun-asr：约 0.17 元
- OSS 上传 + 存储：< 0.01 元（24 小时后自动清理）
- **合计约 0.18 元/首**

## 9. 部署配置清单

### 9.1 阿里云后台
1. 开通"百炼"（Model Studio）服务
2. 创建 API Key（`DASHSCOPE_API_KEY`）
3. 开通 OSS，创建 bucket（建议 oss-cn-beijing，跟 fun-asr 同区）
4. 配置 bucket 跨域规则（CORS），允许 PUT 来源为 Electron 应用域
5. 配置生命周期规则：`audio/` 前缀 24 小时后自动删除
6. 创建 RAM 用户和角色，授权 STS 临时上传

### 9.2 服务端环境变量
```bash
DASHSCOPE_API_KEY=sk-xxx
OSS_RAM_AK=LTAI-xxx       # 用于签发 STS 的 RAM AK
OSS_RAM_SK=xxx
OSS_REGION=oss-cn-beijing
OSS_BUCKET=your-bucket
OSS_ROLE_ARN=acs:ram::xxx:role/xxx
```

### 9.3 npm 依赖
服务端：
```
axios
ali-oss
express (或 fastify)
```

客户端（Electron）：
```
ali-oss
```

## 10. 可选优化

### 10.1 字级 LRC（卡拉 OK 模式）
增强型 LRC 格式支持每字时间戳：
```
[00:12.34]<00:12.34>这<00:12.50>是<00:12.80>第<00:13.10>一<00:13.40>句
```
基于 `charTimes` 数组直接生成，每个字一个内联时间戳。

### 10.2 结果缓存
按音频文件的 MD5/SHA1 hash 作为 key 缓存识别结果。同一首歌只需调用 ASR 一次，二次对齐瞬时完成。缓存可以放在服务端 Redis、本地 SQLite 或 NAS 上的 Gitea LFS。

### 10.3 进度反馈
轮询时把 `PENDING` / `RUNNING` 状态实时推给 UI，避免用户面对静止界面焦虑。可用 SSE 或 WebSocket 推送。

### 10.4 拼音相似度评分
当前 `charCost` 只看字符相等。中文同音字（如"在"和"再"）可以扩展为：
- 先做拼音转换（用 `pinyin` 包）
- 拼音相同记 0.2，否则 1.0

这样 ASR 听错同音字时也能对齐。

### 10.5 Fallback 链
```
fun-asr (歌曲专用)
  ↓ 失败
paraformer-v2 (通用 ASR)
  ↓ 失败
返回错误，让用户手动校对
```

## 11. 测试用例建议

| 用例 | 预期 |
|---|---|
| 标准中文流行歌（4 分钟，清晰人声） | 字时间戳误差 < 200ms 占 > 90% |
| 带前奏 30s 的歌曲 | 第一句歌词时间戳准确，前奏自动跳过 |
| 副歌重复 3 次（歌词已展开） | 每次副歌都对齐到对应位置 |
| 中英混合歌曲 | 英文行也能正确对齐 |
| 歌词中含标点（"你好，世界！"） | LRC 输出保留标点 |
| 歌词比识别结果多 1-2 句 | DTW 通过插值填补缺失时间戳 |
| 纯说唱（高 BPM） | 误差可能放大到 500ms，可接受 |
| **LRC 输入含 `[ar:]` `[ti:]` 元数据** | 元数据行原样写回，不参与对齐 |
| **LRC 输入含纯时间戳间奏标记 `[01:23.45]`** | 按 metadata 透传，输出保留 |
| **LRC 输入旧时间戳整体偏 +3s** | `priorCostPerSec=0.05` 默认下能修正回正确位置 |
| **LRC 输入旧时间戳极烂（每行随机）** | `priorCostPerSec=0` 退化为纯字符匹配，结果与纯文本输入一致 |
| **同行多个时间戳前缀**（`[00:12.34][01:45.67]同一句`） | `parseLrc` 拆为两条 lyric，各自带 priorTime |
| **LRC 行无时间戳（用户混合输入）** | `priorTime=undefined`，DTW 走纯字符匹配该行 |

## 12. 参考链接

- fun-asr 模型介绍：<https://help.aliyun.com/zh/model-studio/recording-file-recognition>
- RESTful API 完整文档：<https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api>
- DashScope 错误码：<https://help.aliyun.com/zh/model-studio/error-code>
- ali-oss SDK：<https://github.com/ali-sdk/ali-oss>
- DTW 算法原理（Wikipedia）：<https://en.wikipedia.org/wiki/Dynamic_time_warping>

---

**实现优先级建议给 Claude Code**：

1. 先实现服务端两个核心接口（`/api/transcribe` 提交 + `/api/transcribe/:taskId` 查询）
2. 用 curl 或 Postman 直接打通 fun-asr 链路，确保能拿到完整识别 JSON
3. 实现 `parseLrc` + `buildLrc` + DTW 生成模块，用 mock 数据单测（先用 `priorCostPerSec: 0` 验证纯字符匹配路径，再开先验项）
4. 接入 OSS 上传
5. 最后集成到 Biu 的 UI 流程（精美播放器「添加歌词」入口）
6. 边做边记录每首测试歌曲的对齐质量，调整 DTW 的 `INSERT_COST` / `DELETE_COST` / `priorCostPerSec`
