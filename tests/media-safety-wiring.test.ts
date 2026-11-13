// @vitest-environment node
import type { AddressInfo } from "node:net";

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";

import { createBilibiliWebMiddleware } from "../plugins/bilibili-web-proxy";
import { runMediaSafetyCommand } from "../web-server/media-safety-cli";
import { createProductionWebServer } from "../web-server/server";

const boundary = vi.hoisted(() => ({ origin: "" }));
vi.mock("../web-server/proxy.js", async () => {
  const actual = await vi.importActual<typeof import("../web-server/proxy")>("../web-server/proxy.js");
  return {
    ...actual,
    createBilibiliProxyHandler: (options: Parameters<typeof actual.createBilibiliProxyHandler>[0]) =>
      actual.createBilibiliProxyHandler({
        ...options,
        sessionProvider: async () => undefined,
        mapUpstreamForTest: target => new URL(target.pathname + target.search, boundary.origin),
      }),
  };
});
const listen = async (server: Server) => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const close = async (server: Server) => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
};

test.each([
  ["production", "option"],
  ["development", "option"],
  ["production", "environment"],
  ["development", "environment"],
] as const)("%s入口通过%s连接媒体账本与本机恢复", async (mode, configuration) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "biu-wiring-"));
  const file = path.join(directory, "media.json");
  writeFileSync(path.join(directory, "index.html"), "static-alive");
  if (configuration === "environment") vi.stubEnv("BIU_WEB_MEDIA_SAFETY_FILE", file);
  const configuredFile = configuration === "option" ? file : undefined;
  let mediaCount = 0;
  let status = 429;
  const upstream = createServer((request, response) => {
    if (request.url?.startsWith("/x/player/playurl")) {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          code: 0,
          data: { dash: { audio: [{ baseUrl: "https://upos-fixture.bilivideo.com/upgcxcode/audio.m4s" }] } },
        }),
      );
    } else {
      mediaCount++;
      response.writeHead(status, { "Content-Type": "audio/mp4" });
      response.end("fixture");
    }
  });
  boundary.origin = await listen(upstream);
  const middleware =
    mode === "development" ? createBilibiliWebMiddleware({ mediaSafetyFile: configuredFile }) : undefined;
  const server =
    mode === "production"
      ? await createProductionWebServer({ staticRoot: directory, mediaSafetyFile: configuredFile })
      : createServer((request, response) =>
          middleware!(request, response, () => {
            response.statusCode = 404;
            response.end();
          }),
        );
  try {
    const origin = await listen(server);
    const resolved = await fetch(`${origin}/__biu_proxy/bilibili/api/x/player/playurl?bvid=synthetic&cid=1`);
    expect(resolved.status).toBe(200);
    const cookie = resolved.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const body = (await resolved.json()) as { data: { dash: { audio: { baseUrl: string }[] } } };
    const media = body.data.dash.audio[0].baseUrl;
    for (let i = 0; i < 2; i++) {
      const blocked = await fetch(origin + media, { headers: { Cookie: cookie!, Range: "bytes=0-0" } });
      expect(blocked.status).toBe(423);
      await blocked.arrayBuffer();
    }
    expect(mediaCount).toBe(1);
    expect((await fetch(origin + "/__biu_health")).status).toBe(200);
    if (mode === "production") expect(await (await fetch(origin + "/")).text()).toContain("static-alive");
    const current = runMediaSafetyCommand(["status", "--file", file]);
    if (!current.initialized) throw new Error("fixture was not initialized");
    runMediaSafetyCommand([
      "resume",
      "--file",
      file,
      "--revision",
      String(current.revision),
      "--confirm",
      "resume-media",
    ]);
    status = 206;
    const recovered = await fetch(origin + media, { headers: { Cookie: cookie!, Range: "bytes=0-0" } });
    expect(recovered.status).toBe(206);
    await recovered.arrayBuffer();
    expect(mediaCount).toBe(2);
    writeFileSync(file, "broken");
    const failed = await fetch(origin + media, { headers: { Cookie: cookie!, Range: "bytes=0-0" } });
    expect(failed.status).toBe(423);
    await failed.arrayBuffer();
    expect(mediaCount).toBe(2);
    expect(readFileSync(file, "utf8")).toBe("broken");
    expect((await fetch(origin + "/__biu_health")).status).toBe(200);
    console.log(
      JSON.stringify({
        mode,
        firstAndBlocked: 1,
        afterExplicitResume: 2,
        afterCorruptStore: 2,
        health: 200,
        scope: "actual application entry; only upstream and anonymous identity boundaries replaced",
      }),
    );
  } finally {
    await close(server);
    await close(upstream);
    rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  }
});
