import type { IncomingMessage, ServerResponse } from "node:http";

import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { createWebApplicationHandler } from "./application.js";
import { captureWebRequestError, ensureWebRequestId, withWebRequestMonitoring } from "./monitoring.js";
import { sendProxyJson } from "./proxy-common.js";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const HASHED_ASSET_PATTERN = /(?:^|[.-])[a-f0-9]{8,}(?:[.-]|$)/i;

export interface ProductionWebServerOptions {
  clientIpHeader?: string;
  clientLogDir?: string;
  clientLogMaxTotalBytes?: number;
  clientLogRetentionDays?: number;
  publicOrigin?: string;
  staticRoot: string;
}

function sendStaticError(response: ServerResponse, status: number, message: string) {
  if (response.headersSent || response.writableEnded) return;
  const body = Buffer.from(message);
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", body.length);
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(body);
}

function decodeStaticPath(requestUrl: string) {
  if (!requestUrl.startsWith("/")) throw new Error("request target must be origin-form");
  const rawPathname = requestUrl.split(/[?#]/, 1)[0];
  const pathname = decodeURIComponent(rawPathname);
  if (pathname.includes("\0") || pathname.includes("\\")) throw new Error("request path is invalid");

  const segments = pathname.split("/");
  if (segments.some(segment => segment === "." || segment === "..")) {
    throw new Error("path traversal is not allowed");
  }
  return pathname;
}

function isInsideRoot(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export async function createStaticWebHandler(staticRoot: string) {
  const root = await realpath(staticRoot);

  return async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader("Referrer-Policy", "no-referrer");

    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendStaticError(response, 405, "Method Not Allowed");
      return;
    }

    let pathname: string;
    try {
      pathname = decodeStaticPath(request.url ?? "/");
    } catch {
      sendStaticError(response, 400, "Bad Request");
      return;
    }

    if (pathname.startsWith("/__biu_")) {
      sendStaticError(response, 404, "Not Found");
      return;
    }

    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const candidate = path.resolve(root, relativePath);
    if (!isInsideRoot(root, candidate)) {
      sendStaticError(response, 400, "Bad Request");
      return;
    }

    let filePath: string;
    let fileStat;
    try {
      filePath = await realpath(candidate);
      if (!isInsideRoot(root, filePath)) throw new Error("static symlink escaped its root");
      fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error("not a file");
    } catch {
      sendStaticError(response, 404, "Not Found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const isHtml = extension === ".html";
    response.statusCode = 200;
    response.setHeader(
      "Cache-Control",
      isHtml
        ? "no-store"
        : HASHED_ASSET_PATTERN.test(path.basename(filePath))
          ? "public, max-age=31536000, immutable"
          : "no-cache",
    );
    response.setHeader("Content-Length", fileStat.size);
    response.setHeader("Content-Type", CONTENT_TYPES[extension] ?? "application/octet-stream");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (method === "HEAD") {
      response.end();
      return;
    }

    try {
      await pipeline(createReadStream(filePath), response);
    } catch (error) {
      if (!response.destroyed) response.destroy(error instanceof Error ? error : undefined);
    }
  };
}

export async function createProductionWebServer(options: ProductionWebServerOptions): Promise<Server> {
  const application = createWebApplicationHandler({
    clientIpHeader: options.clientIpHeader,
    clientLogDir: options.clientLogDir,
    clientLogMaxTotalBytes: options.clientLogMaxTotalBytes,
    clientLogRetentionDays: options.clientLogRetentionDays,
    publicOrigin: options.publicOrigin,
  });
  const staticHandler = await createStaticWebHandler(options.staticRoot);

  return createServer((request, response) => {
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Permissions-Policy", "geolocation=(), payment=(), usb=()");
    response.setHeader("Content-Security-Policy", "base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
    const requestId = ensureWebRequestId(request, response);
    void withWebRequestMonitoring(request, response, requestId, async () => {
      const handled = await application(request, response);
      if (!handled) await staticHandler(request, response);
    }).catch(async error => {
      await captureWebRequestError(error, request, requestId);
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      sendProxyJson(response, 500, { code: -500, message: "Web server request failed", requestId });
    });
  });
}

export function closeProductionWebServer(server: Server, forceAfterMs = 5_000) {
  return new Promise<void>((resolve, reject) => {
    const forceTimer = setTimeout(() => server.closeAllConnections(), forceAfterMs);
    forceTimer.unref();
    server.close(error => {
      clearTimeout(forceTimer);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
}
