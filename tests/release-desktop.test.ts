import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { prepareGitHubReleaseKey } from "../dev_tools/github-release-key.js";
import { releaseDesktop } from "../dev_tools/release-desktop.js";
import pkg from "../package.json";
import { createSignedUpdateEnvelope, createWindowsUpdateMetadata } from "../shared/update-signing.js";

const { run, publish, getRegistered, register } = vi.hoisted(() => ({
  run: vi.fn(),
  publish: vi.fn(),
  getRegistered: vi.fn(),
  register: vi.fn(),
}));
vi.mock("../dev_tools/github-release-trust-tag.js", () => ({
  getRegisteredWindowsKey: getRegistered,
  registerWindowsKey: register,
}));
vi.mock("node:child_process", () => ({ default: { execFileSync: run }, execFileSync: run }));
vi.mock("../dev_tools/publish-github-update.js", () => ({ publishGitHubUpdate: publish }));

const repository = "Example/Biu";
const commit = "a".repeat(40);
let homeDirectory: string;
let keyPath: string;

beforeEach(() => {
  homeDirectory = mkdtempSync(path.join(os.tmpdir(), "biu-desktop-release-"));
  keyPath = path.join(homeDirectory, ".config", "biu", "github", "example", "biu", "update-signing-ed25519.pem");
  vi.spyOn(os, "homedir").mockReturnValue(homeDirectory);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => rmSync(homeDirectory, { recursive: true, force: true }));

function mockTools({
  visibility = "PUBLIC",
  dirty = false,
  tag = "",
  buildFails = false,
  permission = "WRITE",
  branchTip = commit,
  containsCommit = true,
} = {}) {
  run.mockImplementation((command: string, args: string[]) => {
    if (command === "git" && args[0] === "remote") return "https://github.com/Example/Biu.git";
    if (command === "git" && args[0] === "status") return dirty ? " M package.json" : "";
    if (command === "git" && args[0] === "rev-parse") return commit;
    if (command === "git" && args[0] === "merge-base") {
      if (!containsCommit) throw Object.assign(new Error("not an ancestor"), { status: 1 });
      return "";
    }
    if (command === "gh" && ["--version", "auth"].includes(args[0])) return "";
    if (command === "gh" && args[0] === "repo") {
      return JSON.stringify({ nameWithOwner: repository, viewerPermission: permission, visibility });
    }
    if (command === "gh" && args.includes(".[].commit.sha")) return branchTip;
    if (command === "gh" && args.includes("--paginate")) return tag;
    if (command === "gh" && args.includes("download")) return "previous manifest";
    if (command === "cmd.exe" || command === "pnpm") {
      if (buildFails) throw new Error("build failed");
      return "";
    }
    throw new Error(`意外命令 ${command} ${args.join(" ")}`);
  });
}

it("checks without writing a first signing key, building or publishing", async () => {
  mockTools({ branchTip: "b".repeat(40) });
  await releaseDesktop(["--check"], "win32");
  expect(existsSync(keyPath)).toBe(false);
  expect(run.mock.calls.some(([cmd]) => cmd === "cmd.exe")).toBe(false);
  expect(publish).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
});

it.each(["win32", "darwin"] as const)(
  "builds %s for the fork with just its public key, then publishes",
  async system => {
    mockTools();
    const windows = system === "win32";
    await releaseDesktop([], system);
    const call = run.mock.calls.find(([cmd]) => cmd === (windows ? "cmd.exe" : "pnpm"));
    expect(call?.[1].join(" ")).toContain("run build");
    const config = publish.mock.calls[0][0];
    expect(config).toMatchObject({ repository, commit, version: pkg.version, platform: windows ? "win" : "mac" });
    expect(call?.[2].env).toMatchObject({
      BIU_TARGET: "electron",
      BIU_GITHUB_RELEASE_REPO: repository,
      BIU_GITHUB_UPDATE_PUBLIC_KEY: windows ? config.signer.publicKeyBase64 : "",
    });
    expect(existsSync(keyPath)).toBe(windows);
    if (windows) expect(register).toHaveBeenCalledWith(repository, commit, config.signer.publicKeyBase64);
    else expect(register).not.toHaveBeenCalled();
    expect(run.mock.invocationCallOrder.at(-1)).toBeLessThan(publish.mock.invocationCallOrder[0]);
  },
);

it.each([
  [{ dirty: true }, /未提交/],
  [{ visibility: "PRIVATE" }, /公开/],
  [{ permission: "READ" }, /没有.*权限/],
  [{ branchTip: "b".repeat(40), containsCommit: false }, /分支包含本次提交/],
  [{ tag: `biu-win-v${pkg.version}` }, /更高的版本号/],
  [{ tag: "biu-win-v0.0.1" }, /原签名私钥/],
] as const)("stops before creating keys or uploading when prerequisites fail", async (options, message) => {
  mockTools(options);
  await expect(releaseDesktop([], "win32")).rejects.toThrow(message);
  expect(existsSync(keyPath)).toBe(false);
  expect(publish).not.toHaveBeenCalled();
});

it("does not upload stale artifacts after a build failure", async () => {
  mockTools({ buildFails: true });
  await expect(releaseDesktop([], "win32")).rejects.toThrow("build failed");
  expect(publish).not.toHaveBeenCalled();
});

it("stops on an existing key registration even before the first release is visible", async () => {
  mockTools();
  getRegistered.mockReturnValue("existing-key");
  await expect(releaseDesktop([], "win32")).rejects.toThrow(/恢复/);
  expect(existsSync(keyPath)).toBe(false);
  expect(publish).not.toHaveBeenCalled();
});

it("reuses the original key, rejects a different fork’s key and never replaces either", () => {
  const config = { repository, previousRelease: null, checkOnly: false, homeDirectory };
  const signer = prepareGitHubReleaseKey(config)!;
  const original = readFileSync(keyPath);
  const version = "1.0.0";
  const metadata = createWindowsUpdateMetadata({
    arch: "x64",
    filename: "Biu-1.0.0-win-setup-x64.exe",
    size: 100,
    sha512: Buffer.alloc(64, 9).toString("base64"),
    version,
    releaseDate: new Date().toISOString(),
    releaseNotes: "",
  });
  const previousRelease = { version, manifest: createSignedUpdateEnvelope(metadata, signer.privateKey, signer) };
  expect(prepareGitHubReleaseKey({ ...config, previousRelease })?.keyId).toBe(signer.keyId);
  prepareGitHubReleaseKey({ ...config, repository: "elsewhere/biu" });
  expect(() => prepareGitHubReleaseKey({ ...config, repository: "elsewhere/biu", previousRelease })).toThrow(
    /无法验证/,
  );
  expect(readFileSync(keyPath)).toEqual(original);
});
