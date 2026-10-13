import type { IncomingMessage, ServerResponse } from "node:http";

import { constants, gzipSync } from "node:zlib";

import { firstHeader } from "./proxy-common.js";

// 部署机上行实测只有 60~145 KB/s，未压缩的入口 JS 和收藏夹 JSON 会直接吃掉几秒；
// 文本体积 gzip 后通常只剩 1/4~1/6。媒体本身已压缩，绝不能走这里。
const COMPRESSIBLE_TYPE = /^(?:text\/|application\/(?:json|javascript|manifest\+json|xml)|image\/svg\+xml)/i;
const MIN_COMPRESS_BYTES = 1024;

export function acceptsGzip(request: IncomingMessage) {
  return /\bgzip\b/i.test(firstHeader(request.headers["accept-encoding"]) ?? "");
}

export function isCompressibleType(contentType: string | undefined) {
  return Boolean(contentType && COMPRESSIBLE_TYPE.test(contentType));
}

export function gzipBody(body: Buffer) {
  return gzipSync(body, { level: constants.Z_BEST_SPEED });
}

export function shouldGzip(request: IncomingMessage, contentType: string | undefined, size?: number) {
  if (size !== undefined && size < MIN_COMPRESS_BYTES) return false;
  return acceptsGzip(request) && isCompressibleType(contentType);
}

export function markGzipped(response: ServerResponse, length?: number) {
  response.setHeader("Content-Encoding", "gzip");
  response.setHeader("Vary", "Accept-Encoding");
  if (length === undefined) response.removeHeader("Content-Length");
  else response.setHeader("Content-Length", length);
}
