import type { AddressInfo } from "node:net";

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { createBilibiliMediaProxyHandler } from "../web-server/media-proxy";
import { MediaSafetyStore } from "../web-server/media-safety-store";
import { MediaSessionStore } from "../web-server/media-session-store";
import { MediaTokenStore } from "../web-server/media-token-store";

const listen = async (server: Server) => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const close = async (server: Server) => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
};

test.each([
  { status: 429, risk: false },
  { status: 503, risk: false },
  { status: 403, risk: false },
  { status: 412, risk: false },
  { status: 206, risk: false },
  { status: 403, risk: true },
])("持久化媒体闸门 HTTP $status 风控信号 $risk", async ({ status, risk }) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "biu-proxy-safety-"));
  const safetyFile = path.join(directory, "safety.json");
  const safetyStore = new MediaSafetyStore(safetyFile);
  const limited = status === 429 || status >= 500 || risk;
  const upstreamRequests: string[] = [];
  const upstream = createServer((request, response) => {
    upstreamRequests.push(request.headers.range ?? "none");
    response.writeHead(status, {
      "Content-Type": "audio/mp4",
      "Retry-After": "120",
      ...(risk ? { "x-bili-gaia-vvoucher": "synthetic-challenge" } : {}),
    });
    response.end("fixture");
  });
  const upstreamOrigin = await listen(upstream);
  const sessions = new MediaSessionStore();
  const tokens = new MediaTokenStore();
  const handler = createBilibiliMediaProxyHandler({
    safetyStore,
    mediaSessions: sessions,
    mediaTokens: tokens,
    maxMediaRateBytes: 0,
    mapUpstreamForTest: (_target, kind) => {
      expect(kind).toBe("media");
      return new URL(`${upstreamOrigin}/audio`);
    },
  });
  const bff = createServer((request, response) => {
    if (request.url === "/issue") {
      const id = sessions.resolveOrCreate(request, response);
      const path = tokens.register("https://upos-fixture.bilivideo.com/upgcxcode/audio.m4s", id);
      response.end(JSON.stringify({ path }));
      return;
    }
    void handler(request, response);
  });
  try {
    const origin = await listen(bff);
    const issued = await fetch(`${origin}/issue`);
    const cookie = issued.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const { path } = (await issued.json()) as { path: string };
    for (const range of ["bytes=0-0", "bytes=0-65535"]) {
      const response = await fetch(`${origin}${path}`, { headers: { Cookie: cookie!, Range: range } });
      expect(response.status).toBe(limited ? 423 : status);
      await response.arrayBuffer();
    }
    console.log(
      JSON.stringify({
        scenario: "actual-anonymous-media-bff",
        status,
        upstreamRequests: upstreamRequests.length,
        ranges: upstreamRequests,
        loginCookie: false,
        scope: "actual proxy/session/token/HTTP relay with only destination mapped to loopback",
      }),
    );
    expect(upstreamRequests).toHaveLength(limited ? 1 : 2);
    if (limited) {
      const restarted = new MediaSafetyStore(safetyFile);
      expect(() => restarted.begin()).toThrow();
      restarted.resume(restarted.read().revision);
      const restored = await fetch(`${origin}${path}`, { headers: { Cookie: cookie!, Range: "bytes=0-0" } });
      expect(restored.status).toBe(423);
      await restored.arrayBuffer();
      expect(upstreamRequests).toHaveLength(2);
    }
  } finally {
    await close(bff);
    await close(upstream);
    rmSync(directory, { recursive: true, force: true });
  }
});
