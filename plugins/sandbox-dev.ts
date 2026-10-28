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
// 五声音阶，每句歌词换一个音，听得出「在播放、在换句」
const NOTES = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];

function synthesizeWav(): Buffer {
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
  const beat = SAMPLE_RATE / 2;
  for (let i = 0; i < samples; i++) {
    const line = Math.floor(i / (SAMPLE_RATE * SANDBOX_LINE_SECONDS));
    const freq = NOTES[(line + Math.floor(i / beat)) % NOTES.length];
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-3 * ((i % beat) / beat));
    const value = (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t)) * envelope * 0.25;
    buffer.writeInt16LE(Math.round(value * 32_767), 44 + i * 2);
  }
  return buffer;
}

let audio: Buffer | undefined;

// 拖动进度条靠 Range；不支持的话浏览器每次拖动都从头加载
function sendAudio(rangeHeader: string | undefined, response: Parameters<RequestHandler>[1]) {
  audio ??= synthesizeWav();
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
    const pathname = new URL(request.url ?? "/", "http://sandbox.local").pathname;
    if (pathname === SANDBOX_AUDIO_PATH) {
      sendAudio(request.headers.range, response);
      return;
    }
    void alignProxy(request, response, next).catch(next);
  };
}
