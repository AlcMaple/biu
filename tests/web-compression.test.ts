// @vitest-environment node

import type { AddressInfo } from "node:net";

import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import http, { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BILIBILI_UPSTREAMS } from "@shared/bilibili-web-proxy";

import { createBilibiliProxyHandler } from "../web-server/proxy";
import { createStaticWebHandler } from "../web-server/server";

const JSON_BODY = JSON.stringify({ code: 0, data: { medias: Array.from({ length: 50 }, (_, id) => ({ id })) } });
const SCRIPT_BODY = `console.log(${JSON.stringify("x".repeat(4096))});`;

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// fetch 会自动解压，看不出线上字节是否压缩过，所以直接用 http.get 读原始响应
function getRaw(url: string, acceptEncoding?: string) {
  return new Promise<{ body: Buffer; encoding?: string; length?: string }>((resolve, reject) => {
    http
      .get(url, { headers: acceptEncoding ? { "Accept-Encoding": acceptEncoding } : {} }, response => {
        const chunks: Buffer[] = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            encoding: response.headers["content-encoding"],
            length: response.headers["content-length"],
          }),
        );
      })
      .on("error", reject);
  });
}

describe("Web 文本响应压缩", () => {
  const servers: Server[] = [];
  let apiUrl = "";
  let staticOrigin = "";

  beforeAll(async () => {
    const upstream = createServer((_, response) => {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON_BODY);
    });
    const upstreamOrigin = await listen(upstream);

    const handler = createBilibiliProxyHandler({
      logger: { error: vi.fn(), warn: vi.fn() },
      mapUpstreamForTest(target) {
        const mapped = new URL(upstreamOrigin);
        mapped.pathname = target.pathname;
        mapped.search = target.search;
        return mapped;
      },
    });
    const proxy = createServer((request, response) => void handler(request, response));
    apiUrl = `${await listen(proxy)}${BILIBILI_UPSTREAMS.api.proxyPrefix}/x/v3/fav/resource/list?media_id=1`;

    const root = await mkdtemp(path.join(tmpdir(), "biu-static-"));
    await writeFile(path.join(root, "app.js"), SCRIPT_BODY);
    const staticHandler = await createStaticWebHandler(root);
    const staticServer = createServer((request, response) => void staticHandler(request, response));
    staticOrigin = await listen(staticServer);

    servers.push(upstream, proxy, staticServer);
  });

  afterAll(async () => {
    for (const server of servers) server.close();
  });

  it("B 站 JSON 接口按需 gzip，不接受时原样返回", async () => {
    const gzipped = await getRaw(apiUrl, "gzip, deflate, br");
    expect(gzipped.encoding).toBe("gzip");
    expect(gunzipSync(gzipped.body).toString()).toBe(JSON_BODY);

    const plain = await getRaw(apiUrl);
    expect(plain.encoding).toBeUndefined();
    expect(plain.body.toString()).toBe(JSON_BODY);
  });

  it("静态脚本按需 gzip，不接受时原样返回", async () => {
    const gzipped = await getRaw(`${staticOrigin}/app.js`, "gzip, br");
    expect(gzipped.encoding).toBe("gzip");
    expect(Number(gzipped.length)).toBe(gzipped.body.length);
    expect(gzipped.body.length).toBeLessThan(SCRIPT_BODY.length / 4);
    expect(gunzipSync(gzipped.body).toString()).toBe(SCRIPT_BODY);

    const plain = await getRaw(`${staticOrigin}/app.js`);
    expect(plain.encoding).toBeUndefined();
    expect(plain.body.toString()).toBe(SCRIPT_BODY);
  });
});
