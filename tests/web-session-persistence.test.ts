import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSessionPersistence } from "../web-server/auth/session-persistence";
import { WebSessionStore, WEB_SESSION_COOKIE_NAME } from "../web-server/auth/session-store";

const cookie = { domain: "bilibili.com", hostOnly: false, name: "SESSDATA", path: "/", value: "secret-sessdata" };
const dirs: string[] = [];
const tmp = async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), "biu-sess-"));
  dirs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(d => rm(d, { force: true, recursive: true })));
});

const requestFor = (setCookie: string) => ({
  headers: { cookie: `${WEB_SESSION_COOKIE_NAME}=${setCookie.split(";")[0].split("=")[1]}` },
});

describe("session persistence", () => {
  it("restores sessions after a restart and keeps credentials encrypted on disk", async () => {
    const dir = await tmp();
    const first = new WebSessionStore();
    await first.enablePersistence(createSessionPersistence({ dir }));
    const { cookieHeader } = first.createSession({ cookies: [cookie], refreshToken: "refresh-secret" });
    await first.flush();

    const raw = await readFile(path.join(dir, "sessions.enc"));
    expect(raw.toString("utf8")).not.toContain("secret-sessdata");
    expect(raw.toString("latin1")).not.toContain("refresh-secret");
    expect((await stat(path.join(dir, "sessions.enc"))).mode & 0o077).toBe(0);

    const second = new WebSessionStore();
    expect(await second.enablePersistence(createSessionPersistence({ dir }))).toBe(1);
    const restored = second.getSession(requestFor(cookieHeader));
    expect(restored?.refreshToken).toBe("refresh-secret");
    expect([...restored!.cookies.values()][0].value).toBe("secret-sessdata");
  });

  it("starts empty (and keeps a backup) when the file cannot be decrypted", async () => {
    const dir = await tmp();
    const first = new WebSessionStore();
    await first.enablePersistence(createSessionPersistence({ dir, key: "a" }));
    first.createSession({ cookies: [cookie] });
    await first.flush();

    const second = new WebSessionStore();
    const warnings: unknown[] = [];
    const restored = await second.enablePersistence(
      createSessionPersistence({ dir, key: "b", logger: { warn: (...a: unknown[]) => warnings.push(a) } }),
    );
    expect(restored).toBe(0);
    expect(warnings).toHaveLength(1);
  });

  it("slides the expiry on use and drops sessions idle past the TTL", async () => {
    let now = 1_000_000;
    const ttl = 1000 * 60 * 60 * 24;
    const store = new WebSessionStore({ now: () => now, sessionTtlMs: ttl });
    const { cookieHeader } = store.createSession({ cookies: [cookie] });
    const req = requestFor(cookieHeader);

    now += ttl * 0.9;
    expect(store.getSession(req)).toBeDefined();
    now += ttl * 0.9; // 距上次使用仍在 TTL 内，固定过期的话这里已经失效
    expect(store.getSession(req)).toBeDefined();
    now += ttl * 1.1;
    expect(store.getSession(req)).toBeUndefined();
  });
});
