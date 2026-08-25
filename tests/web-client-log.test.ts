// @vitest-environment node

import type { IncomingMessage, ServerResponse } from "node:http";

import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";

import { WEB_CLIENT_LOG_PATH, redactWebClientLogText } from "@shared/web-client-log";

import { createClientLogHandler } from "../web-server/client-log";
import { ClientLogStore } from "../web-server/client-log-store";

const ORIGIN = "https://biu.example";

async function makeDir() {
  return mkdtemp(path.join(tmpdir(), "biu-client-log-"));
}

function request(body: string, overrides: { headers?: Record<string, string>; method?: string; url?: string } = {}) {
  const incoming = Readable.from([Buffer.from(body)]) as IncomingMessage;
  Object.assign(incoming, {
    headers: {
      host: "biu.example",
      "user-agent": "Mozilla/5.0 (iPhone) CriOS/141",
      ...overrides.headers,
    },
    method: overrides.method ?? "POST",
    url: overrides.url ?? WEB_CLIENT_LOG_PATH,
  });
  Object.defineProperty(incoming, "socket", { configurable: true, value: { encrypted: true } });
  return incoming;
}

function capture() {
  const state = { body: "", headers: new Map<string, unknown>(), status: 0 };
  const response = {
    end(chunk?: Buffer) {
      if (chunk) state.body = chunk.toString("utf8");
    },
    getHeader(name: string) {
      return state.headers.get(name.toLowerCase());
    },
    headersSent: false,
    setHeader(name: string, value: unknown) {
      state.headers.set(name.toLowerCase(), value);
      return this;
    },
    set statusCode(value: number) {
      state.status = value;
    },
    get statusCode() {
      return state.status;
    },
    writableEnded: false,
  } as unknown as ServerResponse;
  return { response, state };
}

/** 读取目录里全部日志行 */
async function readRecords(dir: string) {
  const names = (await readdir(dir)).filter(name => name.endsWith(".log"));
  const lines: Record<string, unknown>[] = [];
  for (const name of names) {
    const content = await readFile(path.join(dir, name), "utf8");
    for (const line of content.split("\n")) {
      if (line.trim()) lines.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return lines;
}

describe("网页端日志回传", () => {
  let dir: string;
  let store: ClientLogStore;

  beforeEach(async () => {
    dir = await makeDir();
    store = new ClientLogStore({ dir });
  });

  /** 处理请求后等待落盘：响应本身不等磁盘，测试要等 */
  const settle = () => store.flush();

  it("接收同源 POST 并落盘为 NDJSON，服务端时间与 UA 一并记录", async () => {
    const handler = createClientLogHandler({ dir, publicOrigin: ORIGIN, store });
    const { response, state } = capture();

    const handled = await handler(
      request(
        JSON.stringify({
          entries: [
            { at: 1_700_000_000_000, context: { playId: "abc", httpStatus: 404 }, level: "error", message: "播放失败" },
            { level: "warn", message: "换源重试" },
          ],
          sessionId: "abcdefgh1234",
        }),
      ),
      response,
    );

    expect(handled).toBe(true);
    expect(state.status).toBe(202);

    await settle();
    const records = await readRecords(dir);
    expect(records).toHaveLength(2);
    expect(records[0].level).toBe("error");
    expect(records[0].message).toBe("播放失败");
    expect(records[0].context).toEqual({ playId: "abc", httpStatus: 404 });
    expect(records[0].sessionId).toBe("abcdefgh1234");
    expect(records[0].userAgent).toContain("iPhone");
    expect(typeof records[0].receivedAt).toBe("string");
    // 未配置可信 IP 头时不记录 IP，避免把反代地址当成用户地址
    expect(records[0].ip).toBeUndefined();
  });

  it("媒体代理 token 与凭据参数在落盘前被抹掉", async () => {
    const handler = createClientLogHandler({ dir, publicOrigin: ORIGIN, store });
    const { response } = capture();
    const token = "t".repeat(43);

    await handler(
      request(
        JSON.stringify({
          entries: [
            {
              context: { failedSrc: `/__biu_proxy/bilibili/media/${token}` },
              level: "error",
              message: `加载失败 /__biu_proxy/bilibili/media/${token}?SESSDATA=secret`,
            },
          ],
        }),
      ),
      response,
    );

    await settle();
    const records = await readRecords(dir);
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("secret");
    expect(records[0].message).toContain("<redacted>");
  });

  it("剥离控制字符，避免伪造出额外日志行", async () => {
    const handler = createClientLogHandler({ dir, publicOrigin: ORIGIN, store });
    const { response } = capture();

    await handler(
      request(JSON.stringify({ entries: [{ level: "warn", message: 'a\n{"level":"error","message":"伪造"}' }] })),
      response,
    );

    await settle();
    const records = await readRecords(dir);
    expect(records).toHaveLength(1);
    expect(records[0].message).not.toContain("\n");
  });

  it("拒绝跨站、错误方法、超大 body 与非法 JSON", async () => {
    const handler = createClientLogHandler({ dir, publicOrigin: ORIGIN, store });

    const crossSite = capture();
    await handler(request("{}", { headers: { "sec-fetch-site": "cross-site" } }), crossSite.response);
    expect(crossSite.state.status).toBe(403);

    const wrongMethod = capture();
    await handler(request("{}", { method: "GET" }), wrongMethod.response);
    expect(wrongMethod.state.status).toBe(405);

    const tooLarge = capture();
    await handler(request("x".repeat(40 * 1024)), tooLarge.response);
    expect(tooLarge.state.status).toBe(413);

    const badJson = capture();
    await handler(request("not json"), badJson.response);
    expect(badJson.state.status).toBe(400);

    await settle();
    expect(await readRecords(dir)).toHaveLength(0);
  });

  it("单批条数封顶，非法条目被丢弃", async () => {
    const handler = createClientLogHandler({ dir, publicOrigin: ORIGIN, store });
    const { response } = capture();

    await handler(
      request(
        JSON.stringify({
          entries: [
            ...Array.from({ length: 30 }, (_, index) => ({ level: "warn", message: `第 ${index} 条` })),
            { level: "debug", message: "级别不在白名单" },
            { level: "warn", message: "" },
            "不是对象",
          ],
        }),
      ),
      response,
    );

    await settle();
    expect(await readRecords(dir)).toHaveLength(20);
  });

  it("按可信 IP 限流，超过阈值返回 429", async () => {
    const handler = createClientLogHandler({ clientIpHeader: "x-real-ip", dir, publicOrigin: ORIGIN, store });
    const payload = JSON.stringify({ entries: [{ level: "warn", message: "刷" }] });

    let lastStatus = 0;
    for (let i = 0; i < 61; i += 1) {
      const { response, state } = capture();
      await handler(request(payload, { headers: { "x-real-ip": "203.0.113.9" } }), response);
      lastStatus = state.status;
    }
    expect(lastStatus).toBe(429);

    // 换一个 IP 不受影响
    const other = capture();
    await handler(request(payload, { headers: { "x-real-ip": "203.0.113.10" } }), other.response);
    expect(other.state.status).toBe(202);
  });
});

describe("日志清理", () => {
  it("删除超过保留天数的文件", async () => {
    const dir = await makeDir();
    const now = Date.UTC(2026, 7, 25);
    await writeFile(path.join(dir, "web-client-2026-08-10.log"), "old\n");
    await writeFile(path.join(dir, "web-client-2026-08-24.log"), "recent\n");
    await writeFile(path.join(dir, "unrelated.txt"), "keep\n");

    const store = new ClientLogStore({ dir, now: () => now, retentionDays: 7 });
    const removed = await store.prune();

    expect(removed).toEqual(["web-client-2026-08-10.log"]);
    expect((await readdir(dir)).sort()).toEqual(["unrelated.txt", "web-client-2026-08-24.log"]);
  });

  it("保留期内总体积超限时，从最旧的开始删", async () => {
    const dir = await makeDir();
    const now = Date.UTC(2026, 7, 25);
    await writeFile(path.join(dir, "web-client-2026-08-23.log"), "x".repeat(800));
    await writeFile(path.join(dir, "web-client-2026-08-24.log"), "x".repeat(800));
    await writeFile(path.join(dir, "web-client-2026-08-25.log"), "x".repeat(800));

    const store = new ClientLogStore({ dir, maxTotalBytes: 1600, now: () => now, retentionDays: 30 });
    const removed = await store.prune();

    expect(removed).toEqual(["web-client-2026-08-23.log"]);
    expect((await readdir(dir)).sort()).toEqual(["web-client-2026-08-24.log", "web-client-2026-08-25.log"]);
  });

  it("按天写入独立文件", async () => {
    const dir = await makeDir();
    let now = Date.UTC(2026, 7, 24, 12);
    const store = new ClientLogStore({ dir, now: () => now });

    await store.append([{ message: "day one" }]);
    now = Date.UTC(2026, 7, 25, 12);
    await store.append([{ message: "day two" }]);

    expect((await readdir(dir)).sort()).toEqual(["web-client-2026-08-24.log", "web-client-2026-08-25.log"]);
  });
});

describe("脱敏工具", () => {
  it("同时覆盖代理 token 与常见凭据参数", () => {
    expect(redactWebClientLogText(`/__biu_proxy/bilibili/media/${"a".repeat(43)}`)).toBe(
      "/__biu_proxy/bilibili/media/<redacted>",
    );
    expect(redactWebClientLogText("https://x/y?bili_jct=abc&foo=1")).toBe("https://x/y?bili_jct=<redacted>&foo=1");
  });
});
