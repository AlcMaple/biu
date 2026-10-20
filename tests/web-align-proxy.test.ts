import type { AddressInfo } from "node:net";

import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBiuAlignProxyHandler } from "../web-server/align-proxy.js";
import { createWebSessionResolver } from "../web-server/auth/handler.js";
import { WebSessionStore } from "../web-server/auth/session-store.js";

interface Recorded {
  authorization?: string;
  body: string;
  method?: string;
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
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

describe("Web lyrics-align BFF", () => {
  let appOrigin = "";
  let appServer: Server;
  let upstream: Server;
  let cookie = "";
  let authCalls = 0;
  let expireFirst = false;
  let alignRequests: Recorded[] = [];

  beforeEach(async () => {
    authCalls = 0;
    expireFirst = false;
    alignRequests = [];
    // 同一个上游同时扮演同步服务（换 token）和对齐服务（/api/align…），省一个端口
    upstream = createServer((request, response) => {
      void (async () => {
        const body = await readBody(request);
        if (request.url === "/api/auth/exchange") {
          authCalls += 1;
          sendJson(response, 200, { mid: "42", token: `server-align-token-${authCalls}` });
          return;
        }
        alignRequests.push({
          authorization: request.headers.authorization,
          body,
          method: request.method,
          path: request.url ?? "",
        });
        if (expireFirst && alignRequests.length === 1) {
          sendJson(response, 401, { error: { code: "UNAUTHORIZED", message: "登录已过期" } });
          return;
        }
        if (request.url === "/api/align/jobs") {
          sendJson(response, 429, { error: { code: "QUOTA_EXCEEDED", message: "今天的对齐次数用完了" } });
          return;
        }
        sendJson(response, 200, { ok: true });
      })();
    });
    const upstreamOrigin = await listen(upstream);

    const sessions = new WebSessionStore({ randomToken: () => "s".repeat(32) });
    cookie = sessions
      .createSession({
        cookies: [{ domain: "bilibili.com", hostOnly: false, name: "SESSDATA", path: "/", value: "sess" }],
      })
      .cookieHeader.split(";", 1)[0];
    const handler = createBiuAlignProxyHandler({
      alignInternalOrigin: upstreamOrigin,
      syncInternalOrigin: upstreamOrigin,
      sessionResolver: createWebSessionResolver(sessions),
    });
    appServer = createServer((request, response) => {
      void handler(request, response).then(handled => {
        if (!handled) sendJson(response, 404, { error: "not found" });
      });
    });
    appOrigin = await listen(appServer);
  });

  afterEach(async () => {
    await Promise.all([close(appServer), close(upstream)]);
  });

  it("forwards with the server-held token and passes the service error through verbatim", async () => {
    const res = await fetch(`${appOrigin}/__biu_align/align/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Authorization: "Bearer attacker" },
      body: JSON.stringify({ bvid: "BV13LFNzmEHG", cid: "1", lyrics: "a" }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: { code: "QUOTA_EXCEEDED", message: "今天的对齐次数用完了" } });
    expect(alignRequests[0]).toMatchObject({
      authorization: "Bearer server-align-token-1",
      method: "POST",
      path: "/api/align/jobs",
    });
    expect(JSON.parse(alignRequests[0].body)).toMatchObject({ bvid: "BV13LFNzmEHG" });
  });

  it("re-exchanges once when the upstream token expired", async () => {
    expireFirst = true;
    const res = await fetch(`${appOrigin}/__biu_align/me`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(authCalls).toBe(2);
    expect(alignRequests.at(-1)?.authorization).toBe("Bearer server-align-token-2");
  });

  it("serves approved lyrics without a login and refuses paths outside the whitelist", async () => {
    const open = await fetch(`${appOrigin}/__biu_align/lyrics/BV13LFNzmEHG/123`);
    expect(open.status).toBe(200);
    expect(alignRequests[0].authorization).toBeUndefined();

    const blocked = await fetch(`${appOrigin}/__biu_align/health`, { headers: { Cookie: cookie } });
    expect(blocked.status).toBe(404);
    const needsLogin = await fetch(`${appOrigin}/__biu_align/me`);
    expect(needsLogin.status).toBe(401);
    expect(alignRequests).toHaveLength(1);
  });
});
