import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSyncSafetyGate, type SyncContext } from "@/service/sync/safety-gate";
import { updateSyncSafetyState, type SyncSafetyAction, type SyncSafetyState } from "@shared/sync-safety";

const h = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn(), abandon: vi.fn() }));
vi.mock("@/service/sync/safety", () => ({
  beginSyncRequest: h.begin,
  finishSyncRequest: h.finish,
  abandonSyncRequest: h.abandon,
}));
vi.mock("@/platform", () => ({ default: { getCookie: vi.fn() }, log: { warn: vi.fn() } }));
vi.mock("@/platform/detect", () => ({ isWeb: true }));

let server: Server;
let base: string;
let state: SyncSafetyState | undefined;
let calls: string[];
let signal: number;
let sessionSignal: number;
let unexpectedHtml: boolean;
let failHold: boolean;
let failBegin: boolean;
let unauthorizedOnce: boolean;
let live: Set<string>;
let sequence: number;
function makeGate() {
  let owner: SyncContext | undefined;
  const storage = async (action: SyncSafetyAction) => {
    if ((failBegin && action.kind === "begin") || (failHold && action.kind === "finish" && action.signal))
      throw new Error("storage fixture");
    return (state = updateSyncSafetyState(state, action));
  };
  const context = async () => {
    if (!owner) {
      const id = `context-${++sequence}`;
      live.add(id);
      owner = {
        owner: id,
        liveOwners: async () => new Set(live),
        retire: async () => {
          live.delete(id);
          owner = undefined;
        },
      };
    }
    return owner;
  };
  const gate = createSyncSafetyGate(storage, context, () => {});
  h.abandon.mockImplementation(gate.abandon);
  h.begin.mockImplementation(gate.begin);
  h.finish.mockImplementation(gate.finish);
  return gate;
}
beforeEach(async () => {
  vi.resetModules();
  state = undefined;
  calls = [];
  signal = 0;
  sessionSignal = 0;
  unexpectedHtml = false;
  failHold = false;
  failBegin = false;
  unauthorizedOnce = false;
  live = new Set();
  sequence = 0;
  server = createServer((req, res) => {
    calls.push(req.url ?? "");
    res.setHeader("content-type", "application/json");
    if (req.url === "/session") {
      if (sessionSignal) {
        res.statusCode = sessionSignal;
        res.end("{}");
        return;
      }
      res.end(JSON.stringify({ code: 0, data: { mid: "42" } }));
      return;
    }
    if (unexpectedHtml) {
      res.setHeader("content-type", "text/html");
      res.end("<p>challenge</p>");
      return;
    }
    if (unauthorizedOnce) {
      unauthorizedOnce = false;
      res.statusCode = 401;
      res.end("{}");
      return;
    }
    if (signal) {
      res.statusCode = signal > 0 ? signal : 200;
      res.end(JSON.stringify({ code: signal }));
      return;
    }
    res.end(JSON.stringify({ version: 1, updatedAt: 0, data: {}, changed: false, versions: {} }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server unavailable");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
});
async function client() {
  const { syncHttp } = await import("@/service/sync/http");
  syncHttp.defaults.baseURL = base;
  syncHttp.defaults.adapter = "fetch";
  return import("@/service/sync/client");
}
describe("真实loopback HTTP停手契约", () => {
  it("HTTP200非JSON保留未确认意图，不把挑战页当成功或反复请求", async () => {
    makeGate();
    const api = await client();
    unexpectedHtml = true;
    await expect(api.pullSnapshot("favorites")).rejects.toMatchObject({ code: "BIU_SYNC_PAUSED" });
    const count = calls.length;
    makeGate();
    api.invalidateSyncToken();
    await expect(api.getCurrentMid()).rejects.toMatchObject({ code: "BIU_SYNC_PAUSED" });
    expect(calls).toHaveLength(count);
    expect(state?.pending).toBeDefined();
  });

  it("换票本身503也传播暂停，不静默变成未登录", async () => {
    makeGate();
    const api = await client();
    sessionSignal = 503;
    await expect(api.getCurrentMid()).rejects.toMatchObject({ code: "BIU_SYNC_PAUSED" });
    await expect(api.watchVersions({})).rejects.toMatchObject({ code: "BIU_SYNC_PAUSED" });
    expect(calls).toEqual(["/session"]);
  });

  it.each([429, 503, -412])("收到%i后通知、排行、刷新上下文均零追加请求，显式恢复后才允许", async status => {
    const gate = makeGate();
    const api = await client();
    signal = status;
    await expect(api.pullSnapshot("favorites")).rejects.toMatchObject({ code: "BIU_SYNC_PAUSED" });
    const count = calls.length;
    await expect(api.watchVersions({})).rejects.toMatchObject({ code: "BIU_SYNC_PAUSED" });
    await expect(api.fetchCloudRanking("42")).rejects.toMatchObject({ code: "BIU_SYNC_PAUSED" });
    makeGate();
    api.invalidateSyncToken();
    await expect(api.getCurrentMid()).rejects.toMatchObject({ code: "BIU_SYNC_PAUSED" });
    expect(calls).toHaveLength(count);
    expect(count).toBe(2);
    signal = 0;
    expect(await gate.resume(state!.revision)).toBe(true);
    await expect(api.pullSnapshot("favorites")).resolves.toMatchObject({ version: 1 });
    expect(calls.length).toBeGreaterThan(count);
    console.log(
      JSON.stringify({
        status,
        beforePause: count,
        automaticAfterPause: 0,
        manualRecoveryRequests: calls.length - count,
      }),
    );
  });
  it("限制记录保存失败后，另一个上下文根据盘上意图停手", async () => {
    makeGate();
    const api = await client();
    signal = 429;
    failHold = true;
    await expect(api.pullSnapshot("favorites")).rejects.toMatchObject({ code: "BIU_SYNC_PAUSED" });
    const count = calls.length;
    expect(state?.pending).toBeDefined();
    expect(live.size).toBe(0);
    makeGate();
    api.invalidateSyncToken();
    await expect(api.pullSnapshot("favorites")).rejects.toMatchObject({ code: "BIU_SYNC_PAUSED" });
    expect(calls).toHaveLength(count);
    console.log(
      JSON.stringify({
        scenario: "hold_write_failed_then_new_context",
        sentBefore: count,
        sentAfter: 0,
        durablePending: true,
      }),
    );
  });
  it("出站意图写入失败时，实际HTTP请求为0", async () => {
    makeGate();
    failBegin = true;
    const api = await client();
    await expect(api.getCurrentMid()).rejects.toMatchObject({ code: "BIU_SYNC_PAUSED" });
    expect(calls).toEqual([]);
  });
  it("同账号401保留原单次换票重放，不写人工暂停", async () => {
    makeGate();
    const api = await client();
    unauthorizedOnce = true;
    await expect(api.pullSnapshot("favorites")).resolves.toMatchObject({ version: 1 });
    expect(calls.filter(path => path === "/sync/favorites")).toHaveLength(2);
    expect(state?.hold ?? null).toBeNull();
    expect(state?.pending).toBeUndefined();
  });
});
