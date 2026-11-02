import type { RequestHandler } from "@rsbuild/core";

import { createHmac } from "node:crypto";

import {
  resolveSandboxIdentity,
  SANDBOX_AUDIO_PATH,
  SANDBOX_AUDIO_SECONDS,
  SANDBOX_LINE_SECONDS,
} from "../shared/sandbox";
import { createBiuAlignProxyHandler, type AlignTokenSource } from "../web-server/align-proxy";

// 本地沙盒的 dev 中间件（只在 BIU_TARGET=sandbox 时挂载，由 scripts/sandbox.mjs 启动）：
// 提供合成音频，并把对齐请求按页面选的身份转发给本机 mock 对齐服务

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
function sendAudio(variant: number, rangeHeader: string | undefined, response: Parameters<RequestHandler>[1]) {
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

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

// 和对齐服务验签的 jsonwebtoken 同为 HS256；密钥由 sandbox.mjs 每次启动随机生成，只在这两个进程之间
export function signSandboxToken(mid: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ mid, iat: nowSeconds, exp: nowSeconds + 12 * 3600 }));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function createSandboxMiddleware(): RequestHandler {
  const secret = process.env.BIU_SANDBOX_JWT_SECRET;
  const alignOrigin = process.env.BIU_SANDBOX_ALIGN_ORIGIN;
  if (!secret || !alignOrigin) {
    throw new Error("沙盒要用 `pnpm sandbox` 启动：它会一起起 mock 对齐服务并传入签名密钥");
  }

  const tokenSource: AlignTokenSource = {
    get: async session => ({ token: signSandboxToken(session.sessionId, secret) }),
    invalidate: () => {},
  };
  const alignProxy = createBiuAlignProxyHandler({
    alignInternalOrigin: alignOrigin,
    tokenSource,
    // 未登录身份返回 undefined，走线上同一条「请先登录」分支
    sessionResolver: async request => {
      const { mid } = resolveSandboxIdentity(request.headers.cookie);
      if (!mid) return undefined;
      return { sessionId: mid, cookieHeaderFor: () => "", updateFromSetCookie: () => {} };
    },
  });

  return (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://sandbox.local");
    const pathname = url.pathname;
    if (pathname === SANDBOX_AUDIO_PATH) {
      sendAudio(Number(url.searchParams.get("song")) || 0, request.headers.range, response);
      return;
    }
    void alignProxy(request, response, next).catch(next);
  };
}
