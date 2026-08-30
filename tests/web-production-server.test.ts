// @vitest-environment node

import type { AddressInfo } from "node:net";

import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeProductionWebServer, createProductionWebServer } from "../web-server/server";

async function close(server: Server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

function rawRequest(origin: string, requestPath: string) {
  return new Promise<{ body: string; headers: http.IncomingHttpHeaders; status: number }>((resolve, reject) => {
    const url = new URL(origin);
    const request = http.request(
      {
        host: url.hostname,
        method: "GET",
        path: requestPath,
        port: url.port,
      },
      response => {
        const chunks: Buffer[] = [];
        response.on("data", chunk => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString(),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

describe("production Web server", () => {
  let origin = "";
  let outsideRoot = "";
  let server: Server;
  let staticRoot = "";

  beforeAll(async () => {
    staticRoot = await mkdtemp(path.join(os.tmpdir(), "biu-web-static-"));
    outsideRoot = await mkdtemp(path.join(os.tmpdir(), "biu-web-outside-"));
    await mkdir(path.join(staticRoot, "assets"));
    await writeFile(path.join(staticRoot, "index.html"), "<html>web-index</html>");
    await writeFile(path.join(staticRoot, "assets", "app.0123456789.js"), "console.log('asset')");
    await writeFile(path.join(outsideRoot, "secret.txt"), "server-secret");
    await symlink(path.join(outsideRoot, "secret.txt"), path.join(staticRoot, "escape.txt"));

    server = await createProductionWebServer({ staticRoot });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await close(server);
    await Promise.all([
      rm(staticRoot, { force: true, recursive: true }),
      rm(outsideRoot, { force: true, recursive: true }),
    ]);
  });

  it("serves only root index fallback and applies production response headers", async () => {
    const index = await fetch(`${origin}/`);
    const missing = await fetch(`${origin}/not-a-real-route`);
    const asset = await fetch(`${origin}/assets/app.0123456789.js`);

    expect(index.status).toBe(200);
    expect(await index.text()).toContain("web-index");
    expect(index.headers.get("cache-control")).toBe("no-store");
    expect(index.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(index.headers.get("referrer-policy")).toBe("no-referrer");
    expect(index.headers.get("x-content-type-options")).toBe("nosniff");
    expect(index.headers.get("x-frame-options")).toBe("DENY");
    expect(index.headers.get("permissions-policy")).toBe("geolocation=(), payment=(), usb=()");
    expect(index.headers.get("content-security-policy")).toBe(
      "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
    );
    expect(missing.status).toBe(404);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("does not fall through unknown internal routes or symlinks outside dist/web", async () => {
    expect((await fetch(`${origin}/__biu_unknown`)).status).toBe(404);
    expect((await fetch(`${origin}/escape.txt`)).status).toBe(404);
  });

  it("rejects plain and encoded path traversal before filesystem lookup", async () => {
    expect((await rawRequest(origin, "/../secret.txt")).status).toBe(400);
    expect((await rawRequest(origin, "/%2e%2e/secret.txt")).status).toBe(400);
    expect((await rawRequest(origin, "/assets/%2e%2e%2findex.html")).status).toBe(400);
    expect((await rawRequest(origin, "/assets%5c..%5cindex.html")).status).toBe(400);
  });

  it("exposes a no-store health check from the same process", async () => {
    const response = await fetch(`${origin}/__biu_health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ code: 0, status: "ok" });
  });

  it("force-closes a long-lived response after the shutdown grace period", async () => {
    const hanging = http.createServer((_request, response) => {
      response.writeHead(200);
      response.write("streaming");
    });
    hanging.listen(0, "127.0.0.1");
    await once(hanging, "listening");
    const address = hanging.address() as AddressInfo;
    const connected = new Promise<http.ClientRequest>((resolve, reject) => {
      const request = http.get(`http://127.0.0.1:${address.port}`, response => {
        response.once("data", () => resolve(request));
      });
      request.once("error", reject);
    });
    const request = await connected;

    await closeProductionWebServer(hanging, 20);
    request.destroy();
    expect(hanging.listening).toBe(false);
  });
});
