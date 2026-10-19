import type { downloadAudio, getVideoPage } from "./bilibili.js";
import type { WorkerOutput } from "./result.js";
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
    };
    return out;
  };
}
