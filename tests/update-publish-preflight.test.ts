import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "biu-preflight-test-"));
const key = path.join(directory, "ssh.pem");
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(key, pair.privateKey.export({ type: "pkcs1", format: "pem" }), { mode: 0o600 });
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
const base = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("BIU_UPDATE_") && name !== "SSH_AUTH_SOCK"),
);
const run = (args: string[], config = {}) =>
  spawnSync(process.execPath, ["dev_tools/check-update-publish.js", ...args], {
    encoding: "utf8",
    env: { ...base, HOME: directory, USERPROFILE: directory, ...config },
  });
const config = {
  BIU_UPDATE_PUBLISH_HOST: "updates.example.com",
  BIU_UPDATE_PUBLISH_USER: "publisher",
  BIU_UPDATE_REMOTE_DIR: "/updates",
  BIU_UPDATE_PUBLIC_ORIGIN: "https://updates.example.com/updates/",
  BIU_UPDATE_PUBLISH_KEY: key,
  BIU_UPDATE_SIGNING_KEY: path.join(directory, "absent.pem"),
};
it("reports all missing connection fields before touching artifacts", () => {
  const result = run(["--win", "--config-only"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("BIU_UPDATE_PUBLISH_HOST");
  expect(result.stderr).toContain("BIU_UPDATE_PUBLISH_USER");
});
it("permits Mac-only configuration without a Windows signing key", () => {
  const result = run(["--mac", "--config-only"], config);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("macOS");
});
it("still requires the trusted signing key for Windows", () => {
  expect(run(["--win", "--config-only"], config).status).toBe(1);
});
it("rejects conflicting platforms", () => {
  expect(run(["--mac", "--win"], config).status).toBe(1);
});
