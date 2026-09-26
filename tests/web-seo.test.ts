// @vitest-environment node

import type { AddressInfo } from "node:net";

import { once } from "node:events";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import { createStaticWebHandler } from "../web-server/server";

let server: Server;
let root: string;
let origin: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "biu-seo-"));
  for (const [source, target] of [
    ["src/index.html", "index.html"],
    ["public/robots.txt", "robots.txt"],
    ["public/sitemap.xml", "sitemap.xml"],
  ]) {
    await copyFile(path.resolve(source), path.join(root, target));
  }
  server = createServer(await createStaticWebHandler(root));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server?.listening) {
    server.close();
    await once(server, "close");
  }
  if (root) await rm(root, { recursive: true, force: true });
});

it("includes AlcMaple in the initial HTML title and description without JavaScript", async () => {
  const response = await fetch(origin);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toMatch(/<title>[^<]*AlcMaple[^<]*<\/title>/);
  expect(html).toMatch(/name="description"\s+content="[^"]*AlcMaple[^"]*"/);
  expect(html).not.toContain("windows music application");
});

it.each([
  ["robots.txt", "text/plain", "Sitemap: https://music.alcmaple.cn/sitemap.xml"],
  ["sitemap.xml", "application/xml", "<loc>https://music.alcmaple.cn/</loc>"],
])("serves %s with the correct MIME type for GET and HEAD", async (file, mime, content) => {
  const response = await fetch(`${origin}/${file}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(`${mime}; charset=utf-8`);
  expect(await response.text()).toContain(content);
  const head = await fetch(`${origin}/${file}`, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-type")).toBe(`${mime}; charset=utf-8`);
  expect(await head.text()).toBe("");
});
