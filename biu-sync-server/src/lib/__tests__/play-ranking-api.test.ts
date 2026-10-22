import type { AddressInfo } from "node:net";

import express from "express";
import { once } from "node:events";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBiuSyncProxyHandler } from "../../../../web-server/sync-proxy.js";

let dataDir: string;
vi.mock("../config.js", () => ({
  config: {
    get dataDir() {
      return dataDir;
    },
    jwtSecret: "ranking-tests-only-secret",
    jwtTtlSeconds: 7200,
    rateLimitPerMinute: 10000,
  },
}));

const { signToken } = await import("../auth.js");
const { createSyncRouter } = await import("../../routes/sync.js");
const { getVersions } = await import("../storage.js");
const { pendingWaiters } = await import("../events.js");

const desktop = "11111111-1111-4111-8111-111111111111";
const browser = "22222222-2222-4222-8222-222222222222";
const key = "online:BV1234567890:12";
const record = () => ({ key, title: "测试歌曲", totalCount: 1, recentPlays: [Date.now()] });
const batch = (deviceId = desktop, seq = 1) => ({ expectedMid: "42", deviceId, events: [{ seq, record: record() }] });
let upstream: Server;
let bff: Server;
let origin: string;
let webOrigin: string;

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
}
function createUpstream() {
  const app = express();
  app.use(express.json());
  app.post("/api/auth/exchange", (_req, res) => res.json({ mid: "42", token: signToken("42") }));
  app.use("/api", createSyncRouter());
  return createServer(app);
}
const get = (mid = "42") =>
  fetch(`${origin}/api/play-ranking`, { headers: { Authorization: `Bearer ${signToken(mid)}` } });
const post = (body: unknown, mid = "42") =>
  fetch(`${origin}/api/play-ranking`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signToken(mid)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "biu-ranking-test-"));
  upstream = createUpstream();
  origin = await listen(upstream);
  const proxy = createBiuSyncProxyHandler({
    syncInternalOrigin: origin,
    sessionResolver: async () => ({ sessionId: "test-session-42", cookieHeaderFor: () => "SESSDATA=test-session" }),
  });
  bff = createServer((req, res) => {
    void proxy(req, res).then(handled => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  webOrigin = await listen(bff);
});
afterEach(async () => {
  await close(bff);
  await close(upstream);
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("桌面直连与网页 BFF 共用云端排行", () => {
  it("排行变化通过原有通知通道唤醒另一端", async () => {
    const known = Object.entries(await getVersions("42"))
      .map(([store, version]) => `${store}:${version}`)
      .join(",");
    const watch = fetch(`${origin}/api/watch?versions=${encodeURIComponent(known)}`, {
      headers: { Authorization: `Bearer ${signToken("42")}` },
      signal: AbortSignal.timeout(1500),
    });
    await vi.waitFor(() => expect(pendingWaiters("42")).toBe(1));
    await post(batch());
    const response = await watch;
    expect(await response.json()).toMatchObject({ changed: true, versions: { "play-counts": 1 } });
    expect(pendingWaiters("42")).toBe(0);
  });
  it("两端各播放一次得到同一份总计，重复上报不重复累计，重启后仍保留", async () => {
    expect((await post(batch())).status).toBe(200);
    const web = await fetch(`${webOrigin}/__biu_sync/play-ranking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch(browser)),
    });
    expect(web.status).toBe(200);
    expect((await post(batch())).status).toBe(200);
    const nativeResponse = await get();
    expect(nativeResponse.headers.get("cache-control")).toBe("no-store");
    const native = await nativeResponse.json();
    const browserResult = await (await fetch(`${webOrigin}/__biu_sync/play-ranking`)).json();
    expect(browserResult).toEqual(native);
    expect(native.records[key].totalCount).toBe(2);
    expect(native.records[key].bvid).toBe("BV1234567890");
    expect(native.records[key].recentPlays).toHaveLength(2);
    expect(native.version).toBe(2);
    expect(await getVersions("42")).toMatchObject({ "play-counts": 2 });
    await close(upstream);
    upstream = createUpstream();
    origin = await listen(upstream);
    expect((await (await get()).json()).records[key].totalCount).toBe(2);
    expect((await (await post(batch())).json()).records[key].totalCount).toBe(2);
  });

  it("并发的两台设备都累计，同一设备并发重复请求只累计一次", async () => {
    const responses = await Promise.all([post(batch()), post(batch(browser)), post(batch())]);
    expect(responses.map(r => r.status)).toEqual([200, 200, 200]);
    expect((await (await get()).json()).records[key].totalCount).toBe(2);
  });

  it("账号隔离以登录凭证为准，旧账号批次不进入新账号", async () => {
    await post(batch());
    expect((await (await get("99")).json()).records).toEqual({});
    expect((await post(batch(browser), "99")).status).toBe(409);
    expect((await (await get("99")).json()).records).toEqual({});
    expect((await fetch(`${origin}/api/play-ranking`)).status).toBe(401);
  });

  it("序号缺口或非法内容整批拒绝，原数据不变", async () => {
    expect((await post(batch(desktop, 2))).status).toBe(409);
    const bad = batch();
    bad.events.push({ seq: 3, record: record() });
    expect((await post(bad)).status).toBe(400);
    expect((await (await get()).json()).records).toEqual({});
  });

  it("本地路径与本地封面被拒绝，固定端点没有通用删除能力", async () => {
    const file = batch();
    file.events[0].record.key = `local:${["C:", "Users", "secret"].join("/")}/music.mp3`;
    expect((await post(file)).status).toBe(400);
    const cover = {
      ...batch(),
      events: [{ seq: 1, record: { ...record(), cover: `file:///${["Users", "secret"].join("/")}/cover.jpg` } }],
    };
    expect((await post(cover)).status).toBe(400);
    const generic = await fetch(`${origin}/api/sync/play-counts`, {
      headers: { Authorization: `Bearer ${signToken("42")}` },
    });
    expect(generic.status).toBe(404);
  });

  it("历史累计与近周时间分开保留，超过一周的导入不冒充本周播放", async () => {
    const historical = batch();
    historical.events[0].record.totalCount = 100;
    historical.events[0].record.recentPlays = [Date.now() - 10 * 86400000];
    await post(historical);
    const stats = (await (await get()).json()).records[key];
    expect(stats.totalCount).toBe(100);
    expect(stats.recentPlays.filter((t: number) => t > Date.now() - 7 * 86400000)).toEqual([]);
  });
});
