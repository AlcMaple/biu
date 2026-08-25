// @vitest-environment node

import type { AddressInfo } from "node:net";

import { once } from "node:events";
import http, { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BILIBILI_MEDIA_PROXY_PREFIX, BILIBILI_UPSTREAMS } from "@shared/bilibili-web-proxy";

import { createBilibiliProxyHandler } from "../web-server/proxy";

interface RecordedRequest {
  body: Buffer;
  headers: IncomingHttpHeaders;
  url: string;
}

const FILE_BYTES = Buffer.from("0123456789");
const RANGE_TARGET = "https://upos-sz-mirror08h.bilivideo.com/upgcxcode/range.m4s";
const REDIRECT_TARGET = "https://upos-sz-mirror08h.bilivideo.com/upgcxcode/redirect.m4s";
const SLOW_TARGET = "https://upos-sz-mirror08h.bilivideo.com/upgcxcode/slow.m4s";
const PCDN_TARGET = "https://xy123.mcdn.bilivideo.cn:8082/upgcxcode/pcdn.m4s";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

async function readBody(request: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("Web Bilibili BFF integration", () => {
  const requests: RecordedRequest[] = [];
  const mappedTargets: Array<{ kind: string; target: string }> = [];
  const updateFromSetCookie = vi.fn();
  let upstreamCancelled: (() => void) | undefined;
  let authenticated = true;
  let mockOrigin = "";
  let proxyOrigin = "";
  let mockServer: Server;
  let proxyServer: Server;

  beforeAll(async () => {
    mockServer = createServer(async (request, response) => {
      const body = await readBody(request);
      requests.push({ body, headers: request.headers, url: request.url ?? "/" });
      const url = new URL(request.url ?? "/", "http://mock.local");

      if (url.pathname === "/x/player/playurl") {
        const target =
          url.searchParams.get("case") === "redirect"
            ? REDIRECT_TARGET
            : url.searchParams.get("case") === "slow"
              ? SLOW_TARGET
              : RANGE_TARGET;
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Set-Cookie", ["SESSDATA=rotated-secret; HttpOnly", "bili_jct=rotated-csrf; HttpOnly"]);
        response.end(
          JSON.stringify({
            code: 0,
            data: {
              dash: {
                audio: [{ baseUrl: PCDN_TARGET, backupUrl: [target] }],
              },
            },
          }),
        );
        return;
      }

      if (url.pathname === "/x/test/write") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ code: 0 }));
        return;
      }

      if (url.pathname === "/x/gaia-vgate/v1/validate") {
        response.setHeader("Content-Type", "application/json");
        response.end(
          url.searchParams.has("invalid")
            ? '{"code":0,"data":{"is_valid":1,"grisk_id":"bad;token"}}'
            : '{"code":0,"data":{"is_valid":1,"grisk_id":"gaia-token-safe"}}',
        );
        return;
      }

      if (url.pathname === "/upgcxcode/redirect.m4s") {
        response.statusCode = 302;
        response.setHeader("Location", "https://evil.example/private/file.m4s");
        response.end();
        return;
      }

      if (url.pathname === "/upgcxcode/slow.m4s") {
        response.statusCode = 206;
        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("Content-Range", "bytes 0-999999/1000000");
        const interval = setInterval(() => response.write(Buffer.alloc(16 * 1024, 1)), 5);
        response.once("close", () => {
          clearInterval(interval);
          upstreamCancelled?.();
        });
        return;
      }

      if (url.pathname === "/upgcxcode/range.m4s") {
        expect(request.headers.cookie).toBeUndefined();
        expect(request.headers.referer).toBe("https://www.bilibili.com/");
        expect(request.headers.origin).toBe("https://www.bilibili.com");
        expect(request.headers["accept-encoding"]).toBe("identity");
        const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
        const start = Number(match?.[1] ?? 0);
        const end = match?.[2] ? Number(match[2]) : FILE_BYTES.length - 1;
        const ranged = FILE_BYTES.subarray(start, end + 1);
        response.statusCode = 206;
        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("Content-Length", ranged.length);
        response.setHeader("Content-Range", `bytes ${start}-${end}/${FILE_BYTES.length}`);
        // B 站 CDN 实际把音频 m4s 标成 octet-stream；代理应将其改写为 audio/mp4 供 iOS 播放
        response.setHeader("Content-Type", "application/octet-stream");
        response.end(ranged);
        return;
      }

      response.statusCode = 404;
      response.end("not found");
    });
    mockOrigin = await listen(mockServer);

    const handler = createBilibiliProxyHandler({
      logger: { error: vi.fn(), warn: vi.fn() },
      mapUpstreamForTest(target, kind) {
        mappedTargets.push({ kind, target: target.toString() });
        const mapped = new URL(mockOrigin);
        mapped.pathname = target.pathname;
        mapped.search = target.search;
        return mapped;
      },
      sessionProvider: async () =>
        authenticated
          ? {
              cookieHeaderFor: () => "SESSDATA=server-only-session; bili_jct=server-csrf",
              sessionId: "auth-session",
              updateFromSetCookie,
            }
          : undefined,
    });
    proxyServer = createServer((request, response) => {
      void handler(request, response).then(handled => {
        if (!handled && !response.writableEnded) {
          response.statusCode = 404;
          response.end("not found");
        }
      });
    });
    proxyOrigin = await listen(proxyServer);
  });

  afterAll(async () => {
    await Promise.all([close(proxyServer), close(mockServer)]);
  });

  async function issueMediaToken(mediaCase = "range") {
    const response = await fetch(
      `${proxyOrigin}${BILIBILI_UPSTREAMS.api.proxyPrefix}/x/player/playurl?bvid=BV1&case=${mediaCase}`,
    );
    const payload = (await response.json()) as {
      data: { dash: { audio: Array<{ backupUrl: string[]; baseUrl: string }> } };
    };
    const mediaCookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    return { mediaCookie, response, stream: payload.data.dash.audio[0] };
  }

  it("injects only the server Cookie, captures upstream Set-Cookie, and returns opaque stream tokens", async () => {
    const { mediaCookie, response, stream } = await issueMediaToken();
    const upstream = requests.find(item => item.url.startsWith("/x/player/playurl"));

    expect(response.status).toBe(200);
    expect(mediaCookie).toMatch(/^__Host-biu_media_session=[-_0-9A-Za-z]{32,128}$/);
    expect(response.headers.get("set-cookie")).not.toContain("rotated-secret");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(upstream?.headers.cookie).toBe("SESSDATA=server-only-session; bili_jct=server-csrf");
    expect(updateFromSetCookie).toHaveBeenCalledWith(
      ["SESSDATA=rotated-secret; HttpOnly", "bili_jct=rotated-csrf; HttpOnly"],
      expect.objectContaining({ href: expect.stringContaining("https://api.bilibili.com/x/player/playurl") }),
    );
    expect(stream.baseUrl).toBe("");
    expect(stream.backupUrl).toHaveLength(1);
    expect(stream.backupUrl[0]).toMatch(new RegExp(`^${BILIBILI_MEDIA_PROXY_PREFIX}/[-_0-9A-Za-z]{32,128}$`));
    expect(JSON.stringify(stream)).not.toContain("bilivideo.com");
  });

  it("injects CSRF into multipart writes without forwarding the internal marker or browser cookies", async () => {
    const boundary = "----BiuIntegrationBoundary";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="csrf"\r\n\r\nbrowser-csrf\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="message"\r\n\r\nhello\r\n` +
        `--${boundary}--\r\n`,
    );
    const response = await fetch(`${proxyOrigin}${BILIBILI_UPSTREAMS.api.proxyPrefix}/x/test/write`, {
      body,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Cookie: "__Host-biu_session=browser-opaque; attacker=browser-cookie",
        Origin: proxyOrigin,
        "X-Biu-Csrf": "inject",
      },
      method: "POST",
    });
    const upstream = requests.findLast(item => item.url === "/x/test/write");

    expect(response.status).toBe(200);
    expect(upstream?.body.toString()).toContain("server-csrf");
    expect(upstream?.body.toString()).not.toContain("browser-csrf");
    expect(upstream?.headers["x-biu-csrf"]).toBeUndefined();
    expect(upstream?.headers.cookie).toBe("SESSDATA=server-only-session; bili_jct=server-csrf");
    expect(Number(upstream?.headers["content-length"])).toBe(upstream?.body.length);
  });

  it("lets anonymous Gaia writes use inject-if-present while keeping strict injection authenticated", async () => {
    authenticated = false;
    try {
      const before = requests.length;
      const optional = await fetch(`${proxyOrigin}${BILIBILI_UPSTREAMS.api.proxyPrefix}/x/test/write`, {
        body: "message=hello",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: proxyOrigin,
          "X-Biu-Csrf": "inject-if-present",
        },
        method: "POST",
      });
      const upstream = requests.at(-1);
      const strict = await fetch(`${proxyOrigin}${BILIBILI_UPSTREAMS.api.proxyPrefix}/x/test/write`, {
        body: "message=hello",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: proxyOrigin,
          "X-Biu-Csrf": "inject",
        },
        method: "POST",
      });

      expect(optional.status).toBe(200);
      expect(upstream?.body.toString()).toBe("message=hello");
      expect(upstream?.headers.cookie).toBeUndefined();
      expect(upstream?.headers["x-biu-csrf"]).toBeUndefined();
      expect(strict.status).toBe(401);
      expect(requests).toHaveLength(before + 1);
    } finally {
      authenticated = true;
    }
  });

  it("stores a successful Gaia token only in the server jar and leaves the JSON response unchanged", async () => {
    const response = await fetch(`${proxyOrigin}${BILIBILI_UPSTREAMS.api.proxyPrefix}/x/gaia-vgate/v1/validate`, {
      body: "challenge=ok",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: proxyOrigin },
      method: "POST",
    });

    expect(await response.text()).toBe('{"code":0,"data":{"is_valid":1,"grisk_id":"gaia-token-safe"}}');
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(updateFromSetCookie).toHaveBeenLastCalledWith(
      [expect.stringContaining("x-bili-gaia-vtoken=gaia-token-safe; Domain=.bilibili.com; Path=/")],
      expect.objectContaining({ pathname: "/x/gaia-vgate/v1/validate" }),
    );

    const callsBeforeInvalid = updateFromSetCookie.mock.calls.length;
    await fetch(`${proxyOrigin}${BILIBILI_UPSTREAMS.api.proxyPrefix}/x/gaia-vgate/v1/validate?invalid=1`, {
      body: "challenge=bad",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: proxyOrigin },
      method: "POST",
    });
    expect(updateFromSetCookie).toHaveBeenCalledTimes(callsBeforeInvalid);
  });

  it("rejects forwarded-host spoofing and generic authentication routes before upstream", async () => {
    const before = mappedTargets.length;
    const crossSite = await fetch(`${proxyOrigin}${BILIBILI_UPSTREAMS.api.proxyPrefix}/x/test/write`, {
      body: "message=hello",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "http://evil.example",
        "X-Forwarded-Host": "evil.example",
      },
      method: "POST",
    });
    const auth = await fetch(`${proxyOrigin}${BILIBILI_UPSTREAMS.passport.proxyPrefix}/x/passport-login/web/login`);

    expect(crossSite.status).toBe(403);
    expect(auth.status).toBe(404);
    expect(mappedTargets).toHaveLength(before);
  });

  it("relays byte ranges and Content-Range without exposing the target URL", async () => {
    const { mediaCookie, stream } = await issueMediaToken();
    const response = await fetch(`${proxyOrigin}${stream.backupUrl[0]}`, {
      headers: { Cookie: mediaCookie, Range: "bytes=4-7" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe("bytes 4-7/10");
    // 关键：iOS 的 <audio> 靠这个正确的音频类型才肯解码（上游是 octet-stream）
    expect(response.headers.get("content-type")).toBe("audio/mp4");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("4567");
  });

  it("rejects URL query proxies, wrong media sessions, and non-UPOS redirects", async () => {
    const { mediaCookie, stream } = await issueMediaToken("redirect");
    const beforeArbitrary = mappedTargets.length;
    const arbitrary = await fetch(
      `${proxyOrigin}${BILIBILI_MEDIA_PROXY_PREFIX}?url=${encodeURIComponent(RANGE_TARGET)}`,
    );
    expect(arbitrary.status).toBe(404);
    expect(mappedTargets).toHaveLength(beforeArbitrary);

    const wrongSession = await fetch(`${proxyOrigin}${stream.backupUrl[0]}`, {
      headers: { Cookie: "__Host-biu_media_session=w" + "x".repeat(42) },
    });
    expect(wrongSession.status).toBe(404);

    const beforeRedirect = mappedTargets.length;
    const redirected = await fetch(`${proxyOrigin}${stream.backupUrl[0]}`, { headers: { Cookie: mediaCookie } });
    expect(redirected.status).toBe(502);
    expect(mappedTargets.slice(beforeRedirect)).toEqual([{ kind: "media", target: REDIRECT_TARGET }]);
  });

  it("cancels the upstream media stream when the browser disconnects", async () => {
    const { mediaCookie, stream } = await issueMediaToken("slow");
    const cancelled = new Promise<void>(resolve => {
      upstreamCancelled = resolve;
    });

    await new Promise<void>((resolve, reject) => {
      const request = http.get(
        `${proxyOrigin}${stream.backupUrl[0]}`,
        { headers: { Cookie: mediaCookie } },
        response => {
          response.once("data", () => {
            request.destroy();
            resolve();
          });
        },
      );
      request.once("error", error => {
        if ((error as NodeJS.ErrnoException).code === "ECONNRESET") resolve();
        else reject(error);
      });
    });

    await expect(
      Promise.race([
        cancelled.then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2_000)),
      ]),
    ).resolves.toBe(true);
  });
});
