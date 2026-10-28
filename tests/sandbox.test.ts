import type { AddressInfo } from "node:net";

import { createHmac } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sandboxNeteaseLyrics, sandboxNeteaseSearch, sandboxResponse } from "@/common/sandbox-fixtures";
import { isUrlValid } from "@/common/utils/audio";
import { SANDBOX_AUDIO_PATH, SANDBOX_AUDIO_SECONDS, SANDBOX_IDENTITY_COOKIE } from "@shared/sandbox";

import { createSandboxMiddleware, signSandboxToken } from "../plugins/sandbox-dev";

const SECRET = "sandbox-test-secret";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const close = (server: Server) => new Promise<void>(resolve => server.close(() => resolve()));

function verifyToken(token: string) {
  const [header, payload, signature] = token.split(".");
  const expected = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return { valid: signature === expected, payload: JSON.parse(Buffer.from(payload, "base64url").toString()) };
}

describe("sandbox dev middleware", () => {
  let appOrigin = "";
  let app: Server;
  let upstream: Server;
  let authorizations: (string | undefined)[] = [];

  beforeEach(async () => {
    authorizations = [];
    upstream = createServer((request, response) => {
      authorizations.push(request.headers.authorization);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    });
    vi.stubEnv("BIU_SANDBOX_JWT_SECRET", SECRET);
    vi.stubEnv("BIU_SANDBOX_ALIGN_ORIGIN", await listen(upstream));
    const middleware = createSandboxMiddleware();
    app = createServer((request: IncomingMessage, response: ServerResponse) => {
      middleware(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
    });
    appOrigin = await listen(app);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await close(app);
    await close(upstream);
  });

  it("refuses to start without the launcher's secret", () => {
    vi.stubEnv("BIU_SANDBOX_JWT_SECRET", "");
    expect(() => createSandboxMiddleware()).toThrow("pnpm sandbox");
  });

  it("serves a seekable wav of the advertised length", async () => {
    const full = await fetch(`${appOrigin}${SANDBOX_AUDIO_PATH}`);
    const bytes = Buffer.from(await full.arrayBuffer());
    expect(full.headers.get("content-type")).toBe("audio/wav");
    expect(bytes.readUInt32LE(40) / (bytes.readUInt32LE(24) * 2)).toBe(SANDBOX_AUDIO_SECONDS);

    const range = await fetch(`${appOrigin}${SANDBOX_AUDIO_PATH}`, { headers: { Range: "bytes=100-199" } });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe(`bytes 100-199/${bytes.length}`);
    expect(Buffer.from(await range.arrayBuffer())).toEqual(bytes.subarray(100, 200));
  });

  it("forwards alignment requests as the identity chosen in the page", async () => {
    const response = await fetch(`${appOrigin}/__biu_align/me`, {
      headers: { Cookie: `${SANDBOX_IDENTITY_COOKIE}=admin` },
    });
    expect(response.status).toBe(200);
    const token = authorizations[0]?.replace("Bearer ", "") ?? "";
    expect(verifyToken(token)).toMatchObject({ valid: true, payload: { mid: "900009" } });
  });

  it("treats the guest identity as logged out without calling the alignment service", async () => {
    const response = await fetch(`${appOrigin}/__biu_align/me`, {
      headers: { Cookie: `${SANDBOX_IDENTITY_COOKIE}=guest` },
    });
    expect(response.status).toBe(401);
    expect(authorizations).toEqual([]);
  });

  it("signs tokens that expire", () => {
    const { payload } = verifyToken(signSandboxToken("900001", SECRET, 1000));
    expect(payload).toEqual({ mid: "900001", iat: 1000, exp: 1000 + 12 * 3600 });
  });
});

describe("sandbox fixtures", () => {
  afterEach(() => {
    document.cookie = `${SANDBOX_IDENTITY_COOKIE}=; path=/; max-age=0`;
  });

  it("reports the identity chosen in the page as the logged-in Bilibili user", () => {
    document.cookie = `${SANDBOX_IDENTITY_COOKIE}=userB; path=/`;
    expect(sandboxResponse({ url: "/x/web-interface/nav" })).toMatchObject({ code: 0, data: { mid: 900002 } });

    document.cookie = `${SANDBOX_IDENTITY_COOKIE}=guest; path=/`;
    expect(sandboxResponse({ url: "/x/web-interface/nav" })).toMatchObject({ code: -101, data: { isLogin: false } });
  });

  it("points playback at the local audio with a URL the player treats as valid", () => {
    const response = sandboxResponse({ url: "/x/player/wbi/playurl", params: { bvid: "BV1DEMO00002" } }) as {
      data: { dash: { audio: { baseUrl: string }[] } };
    };
    const url = response.data.dash.audio[0].baseUrl;
    expect(url).toContain(SANDBOX_AUDIO_PATH);
    expect(isUrlValid(url)).toBe(true);
  });

  it("returns the page list as an array, matching Bilibili's pagelist shape", () => {
    expect(sandboxResponse({ url: "/x/player/pagelist", params: { bvid: "BV1DEMO00002" } })).toMatchObject({
      data: [{ cid: 100_011, duration: SANDBOX_AUDIO_SECONDS }],
    });
  });

  it("finds lyrics for every title except the one that simulates no lyrics", () => {
    expect(sandboxNeteaseSearch("梦醒时分").result.songs).toHaveLength(1);
    expect(sandboxNeteaseSearch("Bobby No Peace · Live Session").result.songs).toEqual([]);
    expect(sandboxNeteaseLyrics().lrc.lyric.split("\n")).toHaveLength(12);
  });
});
