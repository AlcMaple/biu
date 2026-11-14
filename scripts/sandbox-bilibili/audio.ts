// 沙盒的测试音频：现场合成，不进仓库、不要 ffmpeg、没有版权问题；假 B 站的 UPOS 地址返回它
import type { ServerResponse } from "node:http";

import { SANDBOX_AUDIO_SECONDS, SANDBOX_LINE_SECONDS } from "../../shared/sandbox";

const SAMPLE_RATE = 22_050;

// 每首示例歌一套调式和速度，换歌听得出来。频率单位 Hz，和弦按一句歌词一个，循环使用
const VARIANTS = [
  // C 大调 I–V–vi–IV，每拍 0.5 s
  {
    beat: 0.5,
    chords: [
      [261.63, 329.63, 392.0],
      [196.0, 246.94, 293.66],
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
    ],
  },
  // A 小调 i–VI–III–VII，每拍 0.6 s
  {
    beat: 0.6,
    chords: [
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [261.63, 329.63, 392.0],
      [196.0, 246.94, 293.66],
    ],
  },
  // G 大调 I–IV–vi–V，每拍 0.45 s
  {
    beat: 0.45,
    chords: [
      [196.0, 246.94, 293.66],
      [261.63, 329.63, 392.0],
      [164.81, 196.0, 246.94],
      [293.66, 369.99, 440.0],
    ],
  },
];

// 原来是每拍换频率的方波感音色：换音时相位断开会爆一下「哒」，听久了刺耳。
// 现在每个音从自己的起点算相位、首尾各 15 ms 淡入淡出（句尾截断的音也一样）并指数衰减，底下垫一层很轻的持续和弦，听起来像柔和的琶音
function synthesizeWav(variant: number): Buffer {
  const { beat, chords } = VARIANTS[variant % VARIANTS.length];
  const samples = SAMPLE_RATE * SANDBOX_AUDIO_SECONDS;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  const lineLen = SAMPLE_RATE * SANDBOX_LINE_SECONDS;
  const beatLen = Math.round(SAMPLE_RATE * beat);
  const fade = SAMPLE_RATE * 0.015;
  for (let i = 0; i < samples; i++) {
    const chord = chords[Math.floor(i / lineLen) % chords.length];
    const inLine = i % lineLen;
    const k = Math.floor(inLine / beatLen);
    const freq = chord[k % 3] * (k % 6 >= 3 ? 2 : 1);
    const n = inLine - k * beatLen;
    const nt = n / SAMPLE_RATE;
    const note =
      Math.sin(2 * Math.PI * freq * nt) *
      Math.min(1, n / fade, (beatLen - n) / fade, (lineLen - inLine) / fade) *
      Math.exp(-4 * nt);
    const lt = inLine / SAMPLE_RATE;
    const lineEnv = Math.min(1, inLine / (SAMPLE_RATE * 0.3), (lineLen - inLine) / (SAMPLE_RATE * 0.3));
    const pad = chord.reduce((sum, f) => sum + Math.sin(2 * Math.PI * (f / 2) * lt), 0) / chord.length;
    const value = (note * 0.22 + pad * 0.06 * lineEnv) * 0.8;
    buffer.writeInt16LE(Math.round(value * 32_767), 44 + i * 2);
  }
  return buffer;
}

const audios = new Map<number, Buffer>();

// 拖动进度条靠 Range；不支持的话浏览器每次拖动都从头加载
export function sendSandboxAudio(variant: number, rangeHeader: string | undefined, response: ServerResponse) {
  let audio = audios.get(variant);
  if (!audio) {
    audio = synthesizeWav(variant);
    audios.set(variant, audio);
  }
  response.setHeader("Content-Type", "audio/wav");
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", "no-store");
  const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) {
    response.setHeader("Content-Length", String(audio.length));
    response.end(audio);
    return;
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, audio.length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), audio.length - 1) : audio.length - 1;
  if (start >= audio.length || start > end) {
    response.statusCode = 416;
    response.setHeader("Content-Range", `bytes */${audio.length}`);
    response.end();
    return;
  }
  response.statusCode = 206;
  response.setHeader("Content-Range", `bytes ${start}-${end}/${audio.length}`);
  response.setHeader("Content-Length", String(end - start + 1));
  response.end(audio.subarray(start, end + 1));
}
