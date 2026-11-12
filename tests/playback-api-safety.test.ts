// @vitest-environment node
import type { AddressInfo } from "node:net";

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";

import { MediaSafetyStore } from "../web-server/media-safety-store";
import { createBilibiliProxyHandler } from "../web-server/proxy";

const listen = async (server: Server) => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const close = async (server: Server) => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
};
const paths = ["/x/player/playurl", "/x/player/wbi/playurl", "/audio/music-service-c/url"];
const success = {
  code: 0,
  data: { dash: { audio: [{ baseUrl: "https://upos-fixture.bilivideo.com/upgcxcode/audio.m4s" }] } },
};
const scenarios = [
  { name: "429", status: 429, body: JSON.stringify({ code: 0 }), risk: false },
  { name: "503", status: 503, body: JSON.stringify({ code: 0 }), risk: false },
  { name: "code-352", status: 200, body: JSON.stringify({ code: -352 }), risk: false },
  { name: "code-412", status: 200, body: JSON.stringify({ code: -412 }), risk: false },
  {
    name: "voucher",
    status: 200,
    body: JSON.stringify({ code: 0, data: { v_voucher: "synthetic-challenge" } }),
    risk: false,
  },
  { name: "risk-header", status: 403, body: "blocked", risk: true },
  { name: "non-json-200", status: 200, body: "<html>unconfirmed</html>", risk: false },
  { name: "invalid-shape-200", status: 200, body: "[]", risk: false },
];

test.each(scenarios)("取址 $name 后三入口/媒体均停，普通接口不误拦", async scenario => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "biu-playback-api-"));
  const file = path.join(directory, "state.json");
  let failing = false;
  let urlRequests = 0;
  let mediaRequests = 0;
  let metadataRequests = 0;
  const upstream = createServer((request, response) => {
    if (request.url?.startsWith("/upgcxcode/")) {
      mediaRequests++;
      response.writeHead(206, { "Content-Type": "audio/mp4" });
      response.end("fixture");
      return;
    }
    if (request.url === "/x/web-interface/view") {
      metadataRequests++;
      response.end(JSON.stringify({ code: 0 }));
      return;
    }
    urlRequests++;
    response.writeHead(failing ? scenario.status : 200, {
      "Content-Type": "application/json",
      ...(failing && scenario.risk ? { "x-bili-gaia-vvoucher": "synthetic" } : {}),
    });
    response.end(failing ? scenario.body : JSON.stringify(success));
  });
  const upstreamOrigin = await listen(upstream);
  const handler = createBilibiliProxyHandler({
    mediaSafetyFile: file,
    sessionProvider: async () => undefined,
    mapUpstreamForTest: target => new URL(target.pathname + target.search, upstreamOrigin),
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  try {
    const origin = await listen(server);
    const prefix = origin + "/__biu_proxy/bilibili/api";
    const initial = await fetch(prefix + paths[0]);
    const cookie = initial.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const data = (await initial.json()) as typeof success;
    const media = data.data.dash.audio[0].baseUrl;
    failing = true;
    const blocked = await fetch(prefix + paths[1], { headers: { Cookie: cookie! } });
    expect(blocked.status).toBe(423);
    await blocked.arrayBuffer();
    for (const endpoint of [...paths, "/x/player/%70layurl", "/x//player/playurl/"]) {
      const next = await fetch(prefix + endpoint, { headers: { Cookie: cookie! } });
      expect(next.status).toBe(423);
      await next.arrayBuffer();
    }
    const bytes = await fetch(origin + media, { headers: { Cookie: cookie!, Range: "bytes=0-0" } });
    expect(bytes.status).toBe(423);
    await bytes.arrayBuffer();
    expect(urlRequests).toBe(2);
    expect(mediaRequests).toBe(0);
    const regular = await fetch(prefix + "/x/web-interface/view");
    expect(regular.status).toBe(200);
    await regular.arrayBuffer();
    expect(metadataRequests).toBe(1);
    const restarted = new MediaSafetyStore(file);
    expect(() => restarted.begin()).toThrow();
    restarted.resume(restarted.read().revision);
    failing = false;
    const resumed = await fetch(prefix + paths[2], { headers: { Cookie: cookie! } });
    expect(resumed.status).toBe(200);
    await resumed.arrayBuffer();
    expect(urlRequests).toBe(3);
    console.log(
      JSON.stringify({
        scenario: scenario.name,
        initialAndLimitedUrlRequests: 2,
        afterFurtherAttempts: 2,
        mediaAfterHold: 0,
        unrelatedMetadata: 1,
        afterExplicitResume: 3,
      }),
    );
  } finally {
    await close(server);
    await close(upstream);
    rmSync(directory, { recursive: true, force: true });
  }
});

test.each([403, 404, 412])("普通HTTP %s的合法JSON错误不直接判风控", async status => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "biu-playback-normal-"));
  let count = 0;
  const upstream = createServer((_request, response) => {
    count++;
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: -101, message: "fixture permission failure" }));
  });
  const upstreamOrigin = await listen(upstream);
  const handler = createBilibiliProxyHandler({
    mediaSafetyFile: path.join(directory, "state.json"),
    sessionProvider: async () => undefined,
    mapUpstreamForTest: () => new URL(upstreamOrigin),
  });
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  try {
    const origin = await listen(server);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(origin + "/__biu_proxy/bilibili/api/x/player/playurl");
      expect(response.status).toBe(status);
      await response.arrayBuffer();
    }
    expect(count).toBe(2);
  } finally {
    await close(server);
    await close(upstream);
    rmSync(directory, { recursive: true, force: true });
  }
});

test.each(["cancel", "disconnect"])("普通%s不遗留未确认意图，后续显式请求可继续", async mode => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "biu-playback-cancel-"));
  const file = path.join(directory, "state.json");
  let failing = true;
  let entered: () => void = () => {};
  const ready = new Promise<void>(resolve => {
    entered = resolve;
  });
  const upstream = createServer((request, response) => {
    if (failing) {
      if (mode === "disconnect") request.socket.destroy();
      else {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.write('{"code":0,"data":');
      }
      entered();
    } else {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(success));
    }
  });
  const upstreamOrigin = await listen(upstream);
  const handler = createBilibiliProxyHandler({
    mediaSafetyFile: file,
    sessionProvider: async () => undefined,
    mapUpstreamForTest: () => new URL(upstreamOrigin),
  });
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  try {
    const origin = await listen(server);
    const url = origin + "/__biu_proxy/bilibili/api/x/player/playurl";
    const controller = new AbortController();
    const pending = fetch(url, { signal: controller.signal }).catch(() => undefined);
    await ready;
    if (mode === "cancel") controller.abort();
    const response = await pending;
    if (response) {
      expect(response.status).toBe(502);
      await response.arrayBuffer();
    }
    const store = new MediaSafetyStore(file);
    await vi.waitFor(() => expect(store.read().pending).toHaveLength(0));
    expect(store.read().reason).toBeNull();
    failing = false;
    const next = await fetch(url);
    expect(next.status).toBe(200);
    await next.arrayBuffer();
  } finally {
    await close(server);
    await close(upstream);
    rmSync(directory, { recursive: true, force: true });
  }
});
