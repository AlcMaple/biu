#!/usr/bin/env node
/**
 * Biu 歌词时间轴对齐 - Windows 端到端测试脚本（单文件，零依赖）
 *
 * 用王力宏《唯一》的 OSS 签名 URL + 故意带错时间戳的 LRC，跑一遍完整链路：
 *   阿里云 paraformer-v2 识别 → DTW 对齐 → 输出校准后的 LRC
 *
 * 运行：
 *   node --env-file=.env test-wei-yi.mjs
 *   # 或带 URL 覆盖 .env：
 *   node --env-file=.env test-wei-yi.mjs "https://biu-lyrics-audio.oss-cn-beijing.aliyuncs.com/audio/...?Expires=..."
 *
 * 算法代码是从 biu-lyrics-server/src/lib/ 内嵌过来的，**不要在这里改算法**，
 * 真要改回 biu-lyrics-server 改，这里只是测试用 snapshot。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv, env, exit } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ────────────────────────────────────────────────────────────────────────────
// 可调参数
// ────────────────────────────────────────────────────────────────────────────

/**
 * 全局后偏移补偿（秒）。ASR 模型（paraformer-v2）标的是音素起始时刻，
 * 但人耳感知的「这句开始」是元音峰值，两者在演唱场景下差 ~1-2s。
 * DTW 对齐后所有时间戳统一加这个值。
 *
 * 经验值：
 *   • 中文流行（《唯一》这种慢歌）：1.5
 *   • 快歌 / 说唱：可能 0.5-1.0
 *   • 切换 ASR 模型后需要重新校准
 *
 * 在 Windows 上微调时直接改这个常量重跑（ASR 结果已缓存，不会再消耗额度）。
 */
const POST_OFFSET_SEC = 1.0;

// ────────────────────────────────────────────────────────────────────────────
// 1. parse-lrc：解析输入 LRC，拆 metadata / lyric
// ────────────────────────────────────────────────────────────────────────────

const ID_TAG_RE = /^\[(ar|ti|al|by|offset|re|ve|au|la|length):/i;
const TIME_TAG_RE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const SINGLE_TIME_TAG_RE = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]$/;

function parseTimeTag(tag) {
  const m = tag.match(SINGLE_TIME_TAG_RE);
  if (!m) return undefined;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  const fracStr = m[3] ?? "0";
  const frac = Number(fracStr.padEnd(3, "0").slice(0, 3));
  return min * 60_000 + sec * 1000 + frac;
}

function parseLrc(lrcText) {
  const result = [];
  for (const raw of lrcText.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) {
      result.push({ type: "metadata", raw });
      continue;
    }
    if (ID_TAG_RE.test(trimmed)) {
      result.push({ type: "metadata", raw });
      continue;
    }
    const tags = trimmed.match(TIME_TAG_RE) ?? [];
    const text = trimmed.replace(TIME_TAG_RE, "").trim();
    if (tags.length === 0) {
      result.push({ type: "lyric", raw, text: trimmed });
      continue;
    }
    if (!text) {
      result.push({ type: "metadata", raw });
      continue;
    }
    if (tags.length === 1) {
      result.push({ type: "lyric", raw, text, priorTime: parseTimeTag(tags[0]) });
      continue;
    }
    for (const tag of tags) {
      result.push({ type: "lyric", raw: `${tag}${text}`, text, priorTime: parseTimeTag(tag) });
    }
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. dtw-align：ASR 字符展开 + DTW + 时间戳插值
// ────────────────────────────────────────────────────────────────────────────

function expandAsrToChars(words) {
  const result = [];
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    if (/^[a-zA-Z0-9'\-]+$/.test(text)) {
      result.push({ char: text.toLowerCase(), time: w.begin_time });
    } else {
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

function charCost(a, b) {
  if (a === b) return 0;
  if (a.toLowerCase() === b.toLowerCase()) return 0.1;
  return 1;
}

function dtwAlign(realChars, asrChars, options = {}) {
  const m = realChars.length;
  const n = asrChars.length;
  const INSERT_COST = options.insertCost ?? 0.3;
  const DELETE_COST = options.deleteCost ?? 1.2;
  const PRIOR_COST_PER_SEC = options.priorCostPerSec ?? 0.05;

  if (m === 0) return [];
  if (n === 0) return new Array(m).fill(null);

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(Infinity));
  for (let j = 0; j <= n; j++) dp[0][j] = 0;

  const matchCost = (real, asr) => {
    const c = charCost(real.char, asr.char);
    if (real.priorTime === undefined || PRIOR_COST_PER_SEC === 0) return c;
    return c + (Math.abs(real.priorTime - asr.time) / 1000) * PRIOR_COST_PER_SEC;
  };

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = matchCost(realChars[i - 1], asrChars[j - 1]);
      dp[i][j] = Math.min(dp[i - 1][j - 1] + c, dp[i - 1][j] + DELETE_COST, dp[i][j - 1] + INSERT_COST);
    }
  }

  let bestJ = n;
  for (let j = 0; j <= n; j++) {
    if (dp[m][j] < dp[m][bestJ]) bestJ = j;
  }

  const mapping = new Array(m).fill(null);
  let i = m;
  let j = bestJ;
  const EPS = 1e-9;
  while (i > 0 && j > 0) {
    const c = matchCost(realChars[i - 1], asrChars[j - 1]);
    if (Math.abs(dp[i][j] - (dp[i - 1][j - 1] + c)) < EPS) {
      mapping[i - 1] = j - 1;
      i--;
      j--;
    } else if (Math.abs(dp[i][j] - (dp[i - 1][j] + DELETE_COST)) < EPS) {
      i--;
    } else {
      j--;
    }
  }

  return mapping;
}

/**
 * 把 DTW 没匹配上的字符（mapping 里的 null）填上时间戳。
 *
 * 核心思路：ASR 覆盖到的字符是「锚点」，用 ASR 真值；没覆盖到的间隙优先用
 * 输入 LRC 的相对节奏（priorTimes）缩放/外推，退化到平均铺只在没 prior 时。
 *
 * - 中间间隙：用 prior 相对时间缩放到前后两个 ASR 锚点之间
 * - 前/尾间隙：用「prior + 锚点处实测的局部偏移」外推
 * - 没 prior：退回按字符数线性铺（旧行为）
 * - 末尾加非递减保险，防 prior 非单调时穿插
 */
function interpolateNulls(mapping, asrChars, audioDurationMs, priorTimes = []) {
  const n = mapping.length;
  if (n === 0) return [];

  const result = mapping.map(idx => (idx === null ? null : asrChars[idx].time));
  const anchors = [];
  for (let i = 0; i < n; i++) if (result[i] !== null) anchors.push(i);

  if (anchors.length === 0) {
    return result.map((_, i) => priorTimes[i] ?? (audioDurationMs * i) / n);
  }

  const first = anchors[0];
  const last = anchors[anchors.length - 1];

  // 前导间隙：prior + 局部 offset，没 prior 则从 0 线性
  if (first > 0) {
    const off = priorTimes[first] !== undefined ? result[first] - priorTimes[first] : null;
    for (let i = 0; i < first; i++) {
      result[i] =
        off !== null && priorTimes[i] !== undefined ? Math.max(0, priorTimes[i] + off) : (result[first] * i) / first;
    }
  }

  // 中间间隙：prior 相对时间缩放到两锚点之间
  for (let a = 0; a < anchors.length - 1; a++) {
    const lo = anchors[a];
    const hi = anchors[a + 1];
    if (hi === lo + 1) continue;
    const loT = result[lo];
    const hiT = result[hi];
    const loP = priorTimes[lo];
    const hiP = priorTimes[hi];
    const usePrior = loP !== undefined && hiP !== undefined && hiP > loP;
    for (let k = lo + 1; k < hi; k++) {
      if (usePrior && priorTimes[k] !== undefined) {
        const frac = Math.max(0, Math.min(1, (priorTimes[k] - loP) / (hiP - loP)));
        result[k] = loT + frac * (hiT - loT);
      } else {
        result[k] = loT + ((hiT - loT) * (k - lo)) / (hi - lo);
      }
    }
  }

  // 尾部间隙：prior + 局部 offset 外推，没 prior 则铺到音频末尾
  if (last < n - 1) {
    const off = priorTimes[last] !== undefined ? result[last] - priorTimes[last] : null;
    for (let i = last + 1; i < n; i++) {
      if (off !== null && priorTimes[i] !== undefined) {
        result[i] = priorTimes[i] + off;
      } else {
        const steps = n - last;
        result[i] = result[last] + ((audioDurationMs - result[last]) * (i - last)) / steps;
      }
    }
  }

  // 非递减保险
  for (let i = 1; i < n; i++) if (result[i] < result[i - 1]) result[i] = result[i - 1];

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. build-lrc：按行回填生成 LRC
// ────────────────────────────────────────────────────────────────────────────

function isPunctuation(c) {
  return /[\s\p{P}]/u.test(c);
}

function formatLrcTime(ms) {
  const safe = Math.max(0, Math.round(ms));
  const min = Math.floor(safe / 60000);
  const sec = Math.floor((safe % 60000) / 1000);
  const cs = Math.floor((safe % 1000) / 10);
  return `[${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}]`;
}

function buildLrc(parsedLines, charTimes) {
  const out = [];
  let charIdx = 0;
  for (const line of parsedLines) {
    if (line.type === "metadata") {
      out.push(line.raw);
      continue;
    }
    const lineChars = Array.from(line.text).filter(c => c.trim() && !isPunctuation(c));
    if (lineChars.length === 0) {
      out.push(line.raw);
      continue;
    }
    const lineTime = charTimes[charIdx];
    if (lineTime !== undefined) {
      out.push(`${formatLrcTime(lineTime)}${line.text}`);
    } else {
      out.push(line.raw);
    }
    charIdx += lineChars.length;
  }
  return out.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// 4. align-pipeline：alignFromAsrResult 主流程
// ────────────────────────────────────────────────────────────────────────────

function alignFromAsrResult(asrResult, lrcText, options = {}) {
  const parsedLines = parseLrc(lrcText);
  const allWords = asrResult.transcripts.flatMap(t => t.sentences.flatMap(s => s.words));
  const asrChars = expandAsrToChars(allWords);

  const realChars = [];
  for (const line of parsedLines) {
    if (line.type !== "lyric") continue;
    const chars = Array.from(line.text).filter(c => c.trim() && !isPunctuation(c));
    for (const c of chars) {
      realChars.push({ char: c, priorTime: line.priorTime });
    }
  }

  const mapping = dtwAlign(realChars, asrChars, options);
  const audioDuration = asrResult.properties.original_duration_in_milliseconds ?? 0;
  const priorTimes = realChars.map(c => c.priorTime);
  const charTimes = interpolateNulls(mapping, asrChars, audioDuration, priorTimes);

  // 全局后偏移补偿：ASR 音素起始 → 人耳元音峰值
  const offsetMs = (options.postOffsetSec ?? 0) * 1000;
  const shiftedTimes = charTimes.map(t => (t === null ? null : Math.max(0, t + offsetMs)));

  return buildLrc(parsedLines, shiftedTimes);
}

// ────────────────────────────────────────────────────────────────────────────
// 5. 阿里云 DashScope ASR client（用原生 fetch，零依赖）
// ────────────────────────────────────────────────────────────────────────────

const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/api/v1";

async function submitTranscription(apiKey, fileUrl, model = "paraformer-v2") {
  const resp = await fetch(`${DASHSCOPE_BASE}/services/audio/asr/transcription`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model,
      input: { file_urls: [fileUrl] },
      parameters: { language_hints: ["zh", "en"] },
    }),
  });
  const data = await resp.json();
  if (!resp.ok || !data?.output?.task_id) {
    throw new Error(`提交任务失败 HTTP ${resp.status}: ${JSON.stringify(data)}`);
  }
  return data.output.task_id;
}

async function queryTranscription(apiKey, taskId) {
  const resp = await fetch(`${DASHSCOPE_BASE}/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`查询失败 HTTP ${resp.status}: ${JSON.stringify(data)}`);
  }
  const output = data.output;
  const status = output?.task_status;

  if (status === "SUCCEEDED") {
    const sub = output.results?.[0];
    if (!sub?.transcription_url) {
      return { status: "FAILED", error: "SUCCEEDED 但没有 transcription_url" };
    }
    if (sub.subtask_status === "FAILED") {
      return { status: "FAILED", error: `子任务失败 ${sub.code}: ${sub.message}` };
    }
    // 第二跳：拿真正的识别 JSON
    const finalResp = await fetch(sub.transcription_url);
    if (!finalResp.ok) {
      throw new Error(`第二跳 GET transcription_url 失败 HTTP ${finalResp.status}`);
    }
    const result = await finalResp.json();
    return { status: "SUCCEEDED", result };
  }
  if (status === "FAILED") {
    return { status: "FAILED", error: output.message ?? output.code ?? "未知失败" };
  }
  return { status };
}

// ────────────────────────────────────────────────────────────────────────────
// 6. 主流程
// ────────────────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  // 配置读取
  const apiKey = env.DASHSCOPE_API_KEY;
  const audioUrl = argv[2] ?? env.AUDIO_URL;

  if (!apiKey || apiKey.startsWith("sk-your")) {
    console.error("❌ DASHSCOPE_API_KEY 未配置。检查 .env 文件。");
    exit(1);
  }
  if (!audioUrl || audioUrl.includes("paste-your-signed-url")) {
    console.error("❌ AUDIO_URL 未配置。");
    console.error("");
    console.error("操作步骤：");
    console.error("  1. 登录 https://oss.console.aliyun.com/，进 biu-lyrics-audio bucket");
    console.error("  2. 文件列表 → audio/ → 找到《唯一》flac 文件");
    console.error("  3. 点详情 → 生成下载链接 → 有效期 86400 秒（24 小时）");
    console.error("  4. 复制完整 URL（含 ? 后所有参数）");
    console.error("  5. 把 URL 粘贴到 .env 的 AUDIO_URL=... 后面（或作为本脚本第 1 个参数）");
    exit(1);
  }

  const lrcPath = join(__dirname, "wei-yi-bad-lyrics.lrc");
  let lrcText;
  try {
    lrcText = readFileSync(lrcPath, "utf-8");
  } catch (err) {
    console.error(`❌ 读不到 ${lrcPath}：`, err.message);
    exit(1);
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  Biu 歌词时间轴对齐 - 王力宏《唯一》端到端测试");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("");
  log(`API Key:      ${apiKey.slice(0, 10)}...（已配置）`);
  log(`音频 URL:     ${audioUrl.slice(0, 80)}...`);
  log(`错时间轴 LRC：${lrcPath}（${lrcText.split("\n").length} 行）`);
  console.log("");

  // === 阶段 1+2: ASR（如果已缓存则跳过） ===
  const asrPath = join(__dirname, "wei-yi-asr-result.json");
  let asrResult;

  if (existsSync(asrPath)) {
    log(`[1+2/5] 检测到缓存的 ASR 结果：${asrPath}`);
    log("     ↪ 跳过 ASR 调用（要重跑请删除上述 JSON 文件）");
    try {
      asrResult = JSON.parse(readFileSync(asrPath, "utf-8"));
    } catch (err) {
      console.error(`❌ 缓存文件读取失败：${err.message}`);
      console.error("   请手动删除该文件后重新运行");
      exit(1);
    }
    console.log("");
  } else {
    // 阶段 1: 提交任务
    log("[1/5] 提交 ASR 任务到阿里云 paraformer-v2...");
    let taskId;
    try {
      taskId = await submitTranscription(apiKey, audioUrl);
    } catch (err) {
      console.error("❌ 提交失败：", err.message);
      exit(1);
    }
    log(`     ✓ taskId: ${taskId}`);
    console.log("");

    // 阶段 2: 轮询
    log("[2/5] 轮询任务状态（每 3 秒一次，超时 5 分钟）...");
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await sleep(3_000);
      const q = await queryTranscription(apiKey, taskId).catch(err => ({ status: "FAILED", error: err.message }));
      log(`     状态: ${q.status}`);
      if (q.status === "SUCCEEDED") {
        asrResult = q.result;
        break;
      }
      if (q.status === "FAILED") {
        console.error("❌ 任务失败：", q.error);
        console.error("");
        console.error("常见原因：");
        console.error("  • FILE_403_FORBIDDEN → 签名 URL 过期，回 OSS 控制台生成新的");
        console.error("  • InvalidApiKey      → DASHSCOPE_API_KEY 错了");
        exit(1);
      }
    }
    if (!asrResult) {
      console.error("❌ 5 分钟超时未完成");
      exit(1);
    }
    console.log("");

    // 保存缓存供后续调参用
    writeFileSync(asrPath, JSON.stringify(asrResult, null, 2));
  }

  // === 阶段 3: 展示 ASR 结果统计 ===
  log(`[3/5] ASR 结果就绪：${asrPath}`);

  const totalSentences = asrResult.transcripts.reduce((acc, t) => acc + (t.sentences?.length ?? 0), 0);
  const totalWords = asrResult.transcripts.reduce(
    (acc, t) => acc + (t.sentences?.reduce((s, sen) => s + (sen.words?.length ?? 0), 0) ?? 0),
    0,
  );
  log(`     音频时长: ${(asrResult.properties.original_duration_in_milliseconds / 1000).toFixed(1)}s`);
  log(`     识别到: ${totalSentences} 句，${totalWords} 个字`);
  console.log("");

  // === 阶段 4: 跑对齐算法 ===
  log(`[4/5] 运行 DTW 对齐算法（priorCostPerSec=0.05，postOffset=${POST_OFFSET_SEC}s）...`);
  const alignedLrc = alignFromAsrResult(asrResult, lrcText, { postOffsetSec: POST_OFFSET_SEC });
  log("     ✓ 对齐完成");
  console.log("");

  // === 阶段 5: 保存输出 + 对比展示 ===
  const outputPath = join(__dirname, "wei-yi-aligned.lrc");
  writeFileSync(outputPath, alignedLrc);
  log(`[5/5] 对齐后 LRC 已保存到：${outputPath}`);
  console.log("");

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  对齐前 vs 对齐后逐行对比（人工验证用）");
  console.log("════════════════════════════════════════════════════════════════════");

  const beforeLines = lrcText.split("\n");
  const afterLines = alignedLrc.split("\n");
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    const before = (beforeLines[i] ?? "").padEnd(40, " ");
    const after = afterLines[i] ?? "";
    if (before.trim() === after.trim()) {
      console.log(`     ${before}  │  ${after}`);
    } else {
      console.log(`  →  ${before}  │  ${after}`);
    }
  }

  console.log("");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  人工验证清单：");
  console.log("    1. 「→」开头的行 = 时间戳被算法修正了的行（应该大部分都被修）");
  console.log("    2. 元数据行（[ar:] [ti:] 等）应该原样未动");
  console.log(`    3. 当前 POST_OFFSET_SEC = ${POST_OFFSET_SEC}s（脚本顶部常量，可改）`);
  console.log("    4. 拿 wei-yi-aligned.lrc 放进任意播放器（VLC / 网易云）配音频试，");
  console.log("       看歌词是不是跟唱准了");
  console.log("");
  console.log("  调参流程（不会再消耗 ASR 额度）：");
  console.log("    • 改脚本顶部 POST_OFFSET_SEC（提早→减小，延后→增大）");
  console.log("    • 重新跑 node --env-file=.env test-wei-yi.mjs");
  console.log("    • ASR 结果已缓存在 wei-yi-asr-result.json，会自动复用");
  console.log("    • 要强制重新跑 ASR：删除 wei-yi-asr-result.json");
  console.log("════════════════════════════════════════════════════════════════════");
}

main().catch(err => {
  console.error("");
  console.error("❌ 未预期错误：", err);
  console.error(err.stack);
  exit(1);
});
