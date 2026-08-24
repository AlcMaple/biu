import type { AddressInfo } from "node:net";

import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebSessionResolver } from "../web-server/auth/handler.js";
import { WebSessionStore } from "../web-server/auth/session-store.js";
import { createBiuSyncProxyHandler } from "../web-server/sync-proxy.js";

interface RecordedUpstreamRequest {
  authorization?: string;
  body: string;
  cookie?: string;
  path: string;
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

describe("Web local-playlist sync BFF", () => {
  let appOrigin = "";
  let appServer: Server;
  let authCalls = 0;
  let failFirstSync = false;
  let issuedCookie = "";
  let syncCalls = 0;
  let syncOrigin = "";
  let syncServer: Server;
  let upstreamRequests: RecordedUpstreamRequest[] = [];

  beforeEach(async () => {
    authCalls = 0;
    failFirstSync = false;
    syncCalls = 0;
    upstreamRequests = [];

    syncServer = createServer((request, response) => {
      void (async () => {
        const body = await readBody(request);
        upstreamRequests.push({
          authorization: typeof request.headers.authorization === "string" ? request.headers.authorization : undefined,
          body,
          cookie: typeof request.headers.cookie === "string" ? request.headers.cookie : undefined,
          path: request.url ?? "",
        });

        if (request.method === "POST" && request.url === "/api/auth/exchange") {
          authCalls += 1;
          sendJson(response, 200, { mid: "42", token: `server-sync-token-${authCalls}` });
          return;
        }

        if (request.method === "GET" && request.url === "/api/sync/favorites") {
          syncCalls += 1;
          if (failFirstSync && syncCalls === 1) {
            sendJson(response, 401, { error: "expired" });
            return;
          }
          sendJson(response, 200, {
            data: { "1": { payload: { title: "same playlist" }, updatedAt: 1 } },
            updatedAt: 1,
            version: 1,
          });
          return;
        }

        sendJson(response, 404, { error: "unexpected upstream request" });
      })().catch(error => {
        response.statusCode = 500;
        response.end(String(error));
      });
    });
    syncOrigin = await listen(syncServer);

    const sessions = new WebSessionStore({ randomToken: () => "s".repeat(32) });
    issuedCookie = sessions
      .createSession({
        cookies: [
          {
            domain: "bilibili.com",
            hostOnly: false,
            name: "SESSDATA",
            path: "/",
            value: "server-only-bilibili-session",
          },
        ],
      })
      .cookieHeader.split(";", 1)[0];
    const syncHandler = createBiuSyncProxyHandler({
      sessionResolver: createWebSessionResolver(sessions),
      syncInternalOrigin: syncOrigin,
    });
    appServer = createServer((request, response) => {
      void syncHandler(request, response).then(handled => {
        if (!handled && !response.writableEnded) sendJson(response, 404, { error: "not found" });
      });
    });
    appOrigin = await listen(appServer);
  });

  afterEach(async () => {
    await Promise.all([close(appServer), close(syncServer)]);
  });

  it("exchanges the server-held Bilibili session and never exposes its sync JWT", async () => {
    const status = await fetch(`${appOrigin}/__biu_sync/session`, {
      headers: { Authorization: "Bearer browser-supplied-token", Cookie: issuedCookie },
    });

    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toBe("no-store");
    const payload = await status.json();
    expect(payload).toEqual({ code: 0, data: { mid: "42" }, message: "0" });
    expect(JSON.stringify(payload)).not.toContain("server-sync-token");
    expect(authCalls).toBe(1);
    expect(upstreamRequests[0]).toMatchObject({
      body: JSON.stringify({ cookie: "SESSDATA=server-only-bilibili-session" }),
      path: "/api/auth/exchange",
    });
  });

  it("uses the server token upstream and ignores browser-supplied authorization", async () => {
    const response = await fetch(`${appOrigin}/__biu_sync/sync/favorites`, {
      headers: { Authorization: "Bearer attacker-token", Cookie: issuedCookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: 1 });
    expect(authCalls).toBe(1);
    expect(syncCalls).toBe(1);
    expect(upstreamRequests.at(-1)).toMatchObject({
      authorization: "Bearer server-sync-token-1",
      cookie: undefined,
      path: "/api/sync/favorites",
    });
  });

  it("re-exchanges once after an expired upstream sync token", async () => {
    failFirstSync = true;

    const response = await fetch(`${appOrigin}/__biu_sync/sync/favorites`, { headers: { Cookie: issuedCookie } });

    expect(response.status).toBe(200);
    expect(authCalls).toBe(2);
    expect(syncCalls).toBe(2);
    expect(upstreamRequests.at(-1)?.authorization).toBe("Bearer server-sync-token-2");
  });

  it("rejects cross-site mutations before contacting the sync service", async () => {
    const response = await fetch(`${appOrigin}/__biu_sync/sync/favorites`, {
      body: JSON.stringify({ baseVersion: 0, ops: [] }),
      headers: { "Content-Type": "application/json", Cookie: issuedCookie, "Sec-Fetch-Site": "cross-site" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(authCalls).toBe(0);
    expect(syncCalls).toBe(0);
  });
});
