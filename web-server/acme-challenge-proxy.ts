import type { IncomingMessage, ServerResponse } from "node:http";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { sendProxyJson, type ProxyNext } from "./proxy-common.js";

export const ACME_CHALLENGE_PATH_PREFIX = "/.well-known/acme-challenge/";

const DEFAULT_ACME_CHALLENGE_TIMEOUT_MS = 10_000;
const CHALLENGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export interface AcmeChallengeProxyHandlerOptions {
  acmeChallengeOrigin?: string;
  timeoutMs?: number;
}

export type AcmeChallengeProxyHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next?: ProxyNext,
) => Promise<boolean>;

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function normalizeAcmeChallengeOrigin(value: string | undefined) {
  if (!value) return undefined;

  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !isLoopbackHostname(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("BIU_ACME_CHALLENGE_ORIGIN must be a loopback HTTP origin without path, query, or credentials");
  }
  return url;
}

function sendAcmeError(response: ServerResponse, status: number, message: string) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  sendProxyJson(response, status, { code: -status, message });
}

function targetFor(origin: URL, token: string) {
  return new URL(`${ACME_CHALLENGE_PATH_PREFIX}${token}`, origin).toString();
}

export function createAcmeChallengeProxyHandler(
  options: AcmeChallengeProxyHandlerOptions = {},
): AcmeChallengeProxyHandler {
  const origin = normalizeAcmeChallengeOrigin(options.acmeChallengeOrigin ?? process.env.BIU_ACME_CHALLENGE_ORIGIN);
  const timeoutMs = options.timeoutMs ?? DEFAULT_ACME_CHALLENGE_TIMEOUT_MS;

  return async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://biu.local");
    if (!url.pathname.startsWith(ACME_CHALLENGE_PATH_PREFIX)) {
      next?.();
      return false;
    }

    const token = url.pathname.slice(ACME_CHALLENGE_PATH_PREFIX.length);
    if (!origin || !CHALLENGE_TOKEN_PATTERN.test(token) || url.search) {
      sendAcmeError(response, 404, "ACME challenge not found");
      return true;
    }

    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendAcmeError(response, 405, "ACME challenge method is not allowed");
      return true;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref();
    request.once("aborted", () => controller.abort());
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });

    try {
      const upstream = await fetch(targetFor(origin, token), {
        headers: { Accept: "text/plain" },
        method,
        redirect: "error",
        signal: controller.signal,
      });
      response.statusCode = upstream.status;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Type", upstream.headers.get("content-type") ?? "text/plain; charset=utf-8");
      const contentLength = upstream.headers.get("content-length");
      if (contentLength) response.setHeader("Content-Length", contentLength);
      if (method === "HEAD" || !upstream.body) {
        response.end();
        return true;
      }
      await pipeline(Readable.fromWeb(upstream.body as unknown as NodeReadableStream), response, {
        signal: controller.signal,
      });
      return true;
    } catch {
      if (!response.writableEnded && !response.destroyed && !controller.signal.aborted) {
        sendAcmeError(response, 502, "ACME challenge service is unavailable");
      }
      return true;
    } finally {
      clearTimeout(timeout);
    }
  };
}
