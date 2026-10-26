// @vitest-environment node

import type { IncomingMessage, ServerResponse } from "node:http";

import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { WEB_LYRICS_PROXY_PATHS } from "@shared/web-lyrics-proxy";

import { createWebLyricsProxyHandler } from "../web-server/lyrics-proxy";

const ORIGIN = "https://biu.example";

function createRequest(url: string, headers: Record<string, string> = {}) {
  const request = Readable.from([]) as IncomingMessage;
  Object.assign(request, {
    headers: { host: "biu.example", origin: ORIGIN, ...headers },
    method: "GET",
    url,
  });
  Object.defineProperty(request, "socket", { configurable: true, value: { encrypted: true } });
  return request;
}

function createResponse() {
  const state = {
    body: "",
    headers: new Map<string, unknown>(),
    status: 0,
    writableEnded: false,
  };
  const response = {
    end(chunk?: Buffer) {
      state.body = chunk?.toString("utf8") ?? "";
      state.writableEnded = true;
    },
    get destroyed() {
      return false;
    },
    get headersSent() {
      return false;
    },
    off() {
      return this;
    },
    once() {
      return this;
    },
    setHeader(name: string, value: unknown) {
      state.headers.set(name.toLowerCase(), value);
      return this;
    },
    get statusCode() {
      return state.status;
    },
    set statusCode(value: number) {
      state.status = value;
    },
    get writableEnded() {
      return state.writableEnded;
    },
  } as unknown as ServerResponse;
  return { response, state };
}

describe("Web 歌词 BFF", () => {
  it.each([
    [
      "网易云搜索",
      `${WEB_LYRICS_PROXY_PATHS.neteaseSearch}?s=%E8%9E%BA%E6%97%8B&type=1&limit=20&offset=0`,
      "https://interface.music.163.com/api/search/get?s=%E8%9E%BA%E6%97%8B&type=1&limit=20&offset=0",
      { result: { songs: [{ id: 1, name: "螺旋" }] } },
    ],
    [
      "网易云听歌识曲",
      `${WEB_LYRICS_PROXY_PATHS.neteaseAudioMatch}?duration=6&audioFP=ab%2Bc%2F%3D`,
      "https://interface.music.163.com/api/music/audio/match?sessionId=0123456789abcdef&algorithmCode=shazam_v2&duration=6&rawdata=ab%2Bc%2F%3D&times=1&decrypt=1",
      { data: { result: [{ song: { id: 1, name: "螺旋" } }] } },
    ],
    [
      "网易云歌词",
      `${WEB_LYRICS_PROXY_PATHS.neteaseLyrics}?id=1`,
      "https://interface.music.163.com/api/song/lyric?id=1&tv=-1&lv=-1&rv=-1&kv=-1&_nmclfl=1",
      { lrc: { lyric: "[00:01.00]螺旋" } },
    ],
    [
      "LrcLib 搜索",
      `${WEB_LYRICS_PROXY_PATHS.lrclibSearch}?q=spiral`,
      "https://lrclib.net/api/search?q=spiral",
      [{ id: 2, trackName: "Spiral", syncedLyrics: "[00:01.00]Spiral" }],
    ],
  ])("将 %s 请求转到固定上游并保留响应", async (_name, path, expectedTarget, payload) => {
    const fetchUpstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }));
    const handler = createWebLyricsProxyHandler({ fetch: fetchUpstream, publicOrigin: ORIGIN });
    const { response, state } = createResponse();

    await expect(handler(createRequest(path), response)).resolves.toBe(true);

    expect(fetchUpstream).toHaveBeenCalledTimes(1);
    expect(String(fetchUpstream.mock.calls[0]?.[0])).toBe(expectedTarget);
    expect(fetchUpstream.mock.calls[0]?.[1]).toMatchObject({ method: "GET", redirect: "error" });
    expect(fetchUpstream.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Cookie");
    expect(state.status).toBe(200);
    expect(JSON.parse(state.body)).toEqual(payload);
  });

  it("拒绝跨站、未知参数和无效响应，不把它们变成上游请求", async () => {
    const fetchUpstream = vi.fn<typeof fetch>();
    const handler = createWebLyricsProxyHandler({ fetch: fetchUpstream, publicOrigin: ORIGIN });

    const crossSite = createResponse();
    await handler(
      createRequest(`${WEB_LYRICS_PROXY_PATHS.lrclibSearch}?q=spiral`, { origin: "https://evil.example" }),
      crossSite.response,
    );
    expect(crossSite.state.status).toBe(403);

    const invalid = createResponse();
    await handler(
      createRequest(`${WEB_LYRICS_PROXY_PATHS.lrclibSearch}?q=spiral&url=https://evil.example`),
      invalid.response,
    );
    expect(invalid.state.status).toBe(400);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it("QQ / 酷狗 / AMLL 走固定模板，只接受歌名、歌手和平台 ID", async () => {
    const fetchUpstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ status: 200, data: { items: [] } })));
    const handler = createWebLyricsProxyHandler({ fetch: fetchUpstream, publicOrigin: ORIGIN });

    const ok = createResponse();
    await handler(
      createRequest(`${WEB_LYRICS_PROXY_PATHS.providerSearch}?provider=amll&title=%E6%99%B4%E5%A4%A9`),
      ok.response,
    );
    expect(String(fetchUpstream.mock.calls[0]?.[0])).toBe(
      "https://api.amll.dev/v1/lyrics/search?musicName=%E6%99%B4%E5%A4%A9&pageSize=20",
    );
    expect(fetchUpstream.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(JSON.parse(ok.state.body)).toEqual({ ok: true, data: [] });

    const invalid = createResponse();
    await handler(
      createRequest(`${WEB_LYRICS_PROXY_PATHS.providerGet}?provider=amll&id=1&url=https://evil.example`),
      invalid.response,
    );
    expect(invalid.state.status).toBe(400);
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });

  it("AI 字幕只转发字幕 CDN 上的字幕文件，不带 Cookie", async () => {
    const fetchUpstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ body: [{ from: 1, to: 2, content: "你好" }] })));
    const handler = createWebLyricsProxyHandler({ fetch: fetchUpstream, publicOrigin: ORIGIN });
    const raw = "//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1?auth_key=1-a-0-b";
    const ok = createResponse();
    await handler(
      createRequest(`${WEB_LYRICS_PROXY_PATHS.aiSubtitle}?url=${encodeURIComponent(raw)}`, { cookie: "SESSDATA=x" }),
      ok.response,
    );
    expect(String(fetchUpstream.mock.calls[0]?.[0])).toBe(
      "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1?auth_key=1-a-0-b",
    );
    expect(fetchUpstream.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(fetchUpstream.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Cookie");
    expect(JSON.parse(ok.state.body)).toEqual({ ok: true, lines: [{ from: 1, to: 2, content: "你好" }] });

    const evil = createResponse();
    await handler(
      createRequest(`${WEB_LYRICS_PROXY_PATHS.aiSubtitle}?url=${encodeURIComponent("https://evil.example/x")}`),
      evil.response,
    );
    expect(evil.state.status).toBe(400);
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });

  it("渠道限流原样带回错误类型，不重试", async () => {
    const fetchUpstream = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 429 }));
    const handler = createWebLyricsProxyHandler({ fetch: fetchUpstream, publicOrigin: ORIGIN });
    const { response, state } = createResponse();

    await handler(createRequest(`${WEB_LYRICS_PROXY_PATHS.providerGet}?provider=qq&id=0039MnYb0qxYhV`), response);

    expect(fetchUpstream).toHaveBeenCalledTimes(1);
    expect(JSON.parse(state.body)).toMatchObject({ ok: false, error: { kind: "rate_limited", provider: "qq" } });
  });

  it("上游失败时返回可识别的 BFF 错误", async () => {
    const fetchUpstream = vi.fn<typeof fetch>().mockResolvedValue(new Response("upstream failure", { status: 503 }));
    const handler = createWebLyricsProxyHandler({ fetch: fetchUpstream, publicOrigin: ORIGIN });
    const { response, state } = createResponse();

    await handler(createRequest(`${WEB_LYRICS_PROXY_PATHS.neteaseSearch}?s=spiral`), response);

    expect(state.status).toBe(502);
    expect(JSON.parse(state.body)).toEqual({ code: -502, message: "歌词服务暂不可用" });
  });

  it("上游失败时日志带上游域名、状态码和 cf-ray", async () => {
    const fetchUpstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad gateway", { status: 502, headers: { "cf-ray": "8f1e2d3c4b5a6978-HKG" } }));
    const logger = { error: vi.fn(), warn: vi.fn() };
    const handler = createWebLyricsProxyHandler({ fetch: fetchUpstream, logger, publicOrigin: ORIGIN });
    const { response, state } = createResponse();

    await handler(createRequest(`${WEB_LYRICS_PROXY_PATHS.lrclibSearch}?q=spiral`), response);

    expect(state.status).toBe(502);
    expect(logger.warn).toHaveBeenCalledWith(
      "[web-lyrics] upstream request failed",
      "lrclib.net",
      "status=502 cf-ray=8f1e2d3c4b5a6978-HKG",
      "歌词服务暂不可用",
    );
  });

  it("上游超时时返回 504，而不是让浏览器一直等待", async () => {
    const fetchUpstream = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
            once: true,
          });
        }),
    );
    const handler = createWebLyricsProxyHandler({ fetch: fetchUpstream, publicOrigin: ORIGIN, timeoutMs: 1 });
    const { response, state } = createResponse();

    await handler(createRequest(`${WEB_LYRICS_PROXY_PATHS.lrclibSearch}?q=spiral`), response);

    expect(state.status).toBe(504);
    expect(JSON.parse(state.body)).toEqual({ code: -504, message: "歌词服务响应超时" });
  });
});
