import type { AddressInfo } from "node:net";

import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createSandboxBilibiliServer } from "../scripts/sandbox-bilibili/server";
import { createWebApplicationHandler } from "../web-server/application";
import { mapToSandboxUpstream, readSandboxUpstreamOrigin } from "../web-server/sandbox-upstream";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const close = (server: Server) => new Promise<void>(resolve => server.close(() => resolve()));

describe("sandbox upstream switch", () => {
  it("only accepts a loopback http origin outside production", () => {
    expect(readSandboxUpstreamOrigin({})).toBeUndefined();
    expect(readSandboxUpstreamOrigin({ BIU_SANDBOX_UPSTREAM_ORIGIN: "http://127.0.0.1:3010" })?.origin).toBe(
      "http://127.0.0.1:3010",
    );
    expect(() =>
      readSandboxUpstreamOrigin({ BIU_SANDBOX_UPSTREAM_ORIGIN: "http://127.0.0.1:3010", NODE_ENV: "production" }),
    ).toThrow();
    expect(() => readSandboxUpstreamOrigin({ BIU_SANDBOX_UPSTREAM_ORIGIN: "http://evil.example" })).toThrow();
    expect(() => readSandboxUpstreamOrigin({ BIU_SANDBOX_UPSTREAM_ORIGIN: "https://127.0.0.1:3010" })).toThrow();
  });

  it("redirects external hosts and leaves loopback services alone", () => {
    const origin = new URL("http://127.0.0.1:3010");
    expect(mapToSandboxUpstream(new URL("https://api.bilibili.com/x/web-interface/nav?a=1"), origin).href).toBe(
      "http://127.0.0.1:3010/__host/api.bilibili.com/x/web-interface/nav?a=1",
    );
    expect(mapToSandboxUpstream(new URL("http://127.0.0.1:3012/api/x"), origin).href).toBe(
      "http://127.0.0.1:3012/api/x",
    );
    expect(mapToSandboxUpstream(new URL("https://api.bilibili.com/x"), undefined).href).toBe(
      "https://api.bilibili.com/x",
    );
  });
});

// 真实 BFF（createWebApplicationHandler）+ 假 B 站：扫码登录、按账号回 nav、播放地址经媒体 token 拿到音频、故障开关
describe("sandbox end to end through the real BFF", () => {
  let fake: Server;
  let app: Server;
  let fakeOrigin = "";
  let appOrigin = "";

  beforeAll(async () => {
    fake = createSandboxBilibiliServer();
    fakeOrigin = await listen(fake);
    vi.stubEnv("BIU_SANDBOX_UPSTREAM_ORIGIN", fakeOrigin);
    const handler = createWebApplicationHandler();
    app = createServer((request, response) => {
      void handler(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
    });
    appOrigin = await listen(app);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await Promise.all([close(app), close(fake)]);
  });

  const cookies = new Map<string, string>();
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  async function call(path: string, init: RequestInit = {}) {
    const response = await fetch(`${appOrigin}${path}`, {
      ...init,
      headers: { Origin: appOrigin, Cookie: cookieHeader(), "Content-Type": "application/json", ...init.headers },
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const index = pair.indexOf("=");
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  const control = (name: string, body: unknown) =>
    fetch(`${fakeOrigin}/__sandbox/${name}`, { method: "POST", body: JSON.stringify(body) });

  async function loginAs(account: string) {
    const qr = (await (await call("/__biu_auth/qrcode", { method: "POST" })).json()) as {
      code: number;
      data: { loginId: string; url: string };
    };
    expect(qr.code).toBe(0);
    const pending = (await (
      await call("/__biu_auth/qrcode/poll", { method: "POST", body: JSON.stringify({ loginId: qr.data.loginId }) })
    ).json()) as { code: number };
    expect(pending.code).toBe(86039);
    const authCode = new URL(qr.data.url).searchParams.get("auth_code");
    expect((await control("approve", { authCode, account })).status).toBe(200);
    const done = (await (
      await call("/__biu_auth/qrcode/poll", { method: "POST", body: JSON.stringify({ loginId: qr.data.loginId }) })
    ).json()) as { code: number; data: { user: { mid: number } } };
    expect(done.code).toBe(0);
    return done.data.user.mid;
  }

  const nav = async () =>
    (await (await call("/__biu_proxy/bilibili/api/x/web-interface/nav")).json()) as {
      code: number;
      data: { mid?: number; isLogin: boolean };
    };

  it("logs in by QR, scopes data by account, and logs out", async () => {
    expect((await nav()).code).toBe(-101);
    expect(await loginAs("userA")).toBe(900001);
    expect((await nav()).data.mid).toBe(900001);

    const folders = (await (
      await call("/__biu_proxy/bilibili/api/x/v3/fav/folder/created/list-all?up_mid=900001")
    ).json()) as { data: { list: { title: string }[] } };
    expect(folders.data.list.map(f => f.title)).toContain("A 的通勤歌单");

    expect((await call("/__biu_auth/logout", { method: "POST" })).status).toBe(200);
    expect((await nav()).code).toBe(-101);
    expect(await loginAs("userB")).toBe(900002);
    const foldersB = (await (
      await call("/__biu_proxy/bilibili/api/x/v3/fav/folder/created/list-all?up_mid=900002")
    ).json()) as { data: { list: { title: string }[] } };
    expect(foldersB.data.list.map(f => f.title)).not.toContain("A 的通勤歌单");
  });

  it("serves playable audio through the BFF media token, and drops PCDN hosts", async () => {
    const playurl = async () =>
      (await (await call("/__biu_proxy/bilibili/api/x/player/wbi/playurl?bvid=BV1DEMO00001&cid=100010")).json()) as {
        data: { dash: { audio: { baseUrl: string; backupUrl: string[] }[] } };
      };
    const stream = (await playurl()).data.dash.audio[0];
    expect(stream.baseUrl).toMatch(/^\/__biu_proxy\/bilibili\/media\//);
    const media = await call(stream.baseUrl, { headers: { Range: "bytes=0-11" } });
    expect(media.status).toBe(206);
    expect(
      Buffer.from(await media.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe("RIFF");

    await control("state", { pcdn: true });
    const pcdn = (await playurl()).data.dash.audio[0];
    // BFF 的媒体放行名单拒收 mcdn 主地址，只留下 UPOS 备用地址
    expect(pcdn.baseUrl).toBe("");
    expect(pcdn.backupUrl).toHaveLength(1);
    await control("state", { pcdn: false });
  });

  it("injects upstream faults that surface as real HTTP failures", async () => {
    await control("state", { faults: [{ match: "/x/web-interface/nav", kind: "412" }] });
    expect((await call("/__biu_proxy/bilibili/api/x/web-interface/nav")).status).toBe(412);
    await control("state", { faults: [{ match: "/x/web-interface/nav", kind: "429" }] });
    expect((await call("/__biu_proxy/bilibili/api/x/web-interface/nav")).status).toBe(429);
    await control("state", { faults: [] });
    expect((await call("/__biu_proxy/bilibili/api/x/web-interface/nav")).status).toBe(200);
  });
});
