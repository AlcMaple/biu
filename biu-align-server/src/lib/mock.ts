import type { downloadAudio, downloadVideo, getVideoPage } from "./bilibili.js";
import type { WorkerOutput } from "./result.js";
import type { RunScreen } from "./screen-worker.js";
import type { RunWorker } from "./worker.js";

// 开发用的假对齐：不访问 B 站、不需要 Python 和模型，几秒后按歌词时间造一份「看起来像真的」结果。
// 用来调客户端界面、轮询、审核流程；时间轴本身没有任何参考价值。生产环境禁止开启（见 config.ts）。

const PUNCT = /[\p{P}\p{S}\p{Z}_]/u;

export const mockGetVideoPage: typeof getVideoPage = async (bvid, cid) => ({
  bvid,
  cid,
  title: `（mock）${bvid}`,
  part: "",
  durationSec: 240,
});

export const mockDownloadAudio: typeof downloadAudio = async () => {};

export function mockRunWorker(delayMs: number): RunWorker {
  return async (_audio, lines) => {
    await new Promise(r => setTimeout(r, delayMs));
    // 有原时间就沿用（整体晚 0.3 s，模拟投稿偏移）；纯文本就每行 3 s 顺排
    const starts = lines.map((l, i) => (lines.some(x => x.t > 0) ? l.t + 0.3 : 5 + i * 3));
    const out: WorkerOutput = {
      lang: "zh",
      lines: lines.map((l, i) => {
        const chars = [...l.text].filter(c => c.trim() && !PUNCT.test(c));
        const span = Math.max(0.5, Math.min((starts[i + 1] ?? starts[i] + 3) - starts[i] - 0.3, chars.length * 0.35));
        return {
          text: l.text,
          chars,
          t: chars.map((_, k) => Number((starts[i] + (span * k) / chars.length).toFixed(3))),
          score: 0.5,
        };
      }),
      offset: lines.some(l => l.t > 0) ? 0.3 : 0,
      frameMs: 20,
      timelineMatch: lines.some(l => l.t > 0) ? 1 : null,
    };
    return out;
  };
}

export const mockDownloadVideo: typeof downloadVideo = async () => {};

// 画面识别的假结果：直接把字幕当成「画面上的歌词」。字幕里带「低吻合」就标成不可信，带「无画面」就当画面上没歌词，
// 方便调客户端的三种来源提示
export function mockRunScreen(delayMs: number): RunScreen {
  return async (_video, subtitle) => {
    await new Promise(r => setTimeout(r, delayMs));
    const text = subtitle.map(s => s.content).join("");
    const lines = subtitle.map(s => ({ t: s.from, text: s.content.replace(/♪/g, "").trim() })).filter(l => l.text);
    if (!lines.length) return { from: null, lines: [], confident: false };
    if (text.includes("无画面")) return { from: "subtitle", lines, confident: false };
    return { from: "screen", lines, confident: !text.includes("低吻合") };
  };
}
