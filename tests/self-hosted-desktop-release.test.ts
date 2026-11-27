import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { releaseSelfHostedDesktop } from "../dev_tools/release-self-hosted-desktop.js";
import pkg from "../package.json";

const run = vi.hoisted(() => vi.fn());
const checkArtifacts = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ default: { execFileSync: run }, execFileSync: run }));
vi.mock("../dev_tools/update-artifacts.js", () => ({ getDesktopReleaseArtifacts: checkArtifacts }));
vi.mock("../dev_tools/update-env.js", () => ({
  loadUpdateEnvironment: ({ environment }: { environment: NodeJS.ProcessEnv }) => {
    environment.BIU_UPDATE_PUBLIC_ORIGIN = "https://updates.example.com/biu/";
  },
}));

const checkConfig = ["dev_tools/check-update-publish.js", "--win", "--config-only"];
const checkServer = ["dev_tools/upload-update.js", "--win", "--check"];
const upload = ["dev_tools/upload-update.js", "--win"];

beforeEach(() => {
  run.mockReset();
  checkArtifacts.mockReset();
  vi.stubEnv("BIU_GITHUB_RELEASE_REPO", "Example/Biu");
  vi.stubEnv("BIU_GITHUB_UPDATE_PUBLIC_KEY", "other-channel-key");
  vi.stubEnv("BIU_TARGET", "web");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("checks Windows signing and server access without building or uploading", () => {
  releaseSelfHostedDesktop(["--check"], "win32");
  expect(run.mock.calls.map(([, args]) => args)).toEqual([checkConfig, checkServer]);
  expect(checkArtifacts).not.toHaveBeenCalled();
  expect(console.log).toHaveBeenLastCalledWith("预检通过。本次未构建、未上传。");
});

it("builds for the original site and verifies both published Windows architectures", () => {
  releaseSelfHostedDesktop([], "win32");
  expect(run.mock.calls.map(([, args]) => args)).toEqual([
    checkConfig,
    checkServer,
    ["/d", "/c", "pnpm run build"],
    upload,
    ["dev_tools/verify-update-manifest.js", "--x64", "--version", pkg.version, "--blockmap"],
    ["dev_tools/verify-update-manifest.js", "--arm64", "--version", pkg.version, "--blockmap"],
  ]);
  expect(checkArtifacts).toHaveBeenCalledWith(expect.any(String), pkg.version, "win");
  expect(checkArtifacts.mock.invocationCallOrder[0]).toBeGreaterThan(run.mock.invocationCallOrder[2]);
  expect(checkArtifacts.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[3]);
  expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("本次未构建"));
  for (const [, , { env }] of run.mock.calls) {
    expect(env.BIU_TARGET).toBe("electron");
    expect(env.BIU_UPDATE_PUBLIC_ORIGIN).toBe("https://updates.example.com/biu/");
    expect(env).not.toHaveProperty("BIU_GITHUB_RELEASE_REPO");
    expect(env).not.toHaveProperty("BIU_GITHUB_UPDATE_PUBLIC_KEY");
  }
});

it.each([checkServer[0], "build", "artifacts"])("stops before uploading after %s fails", failure => {
  if (failure === "artifacts") {
    checkArtifacts.mockImplementation(() => {
      throw new Error("release step failed");
    });
  }
  run.mockImplementation((_command, args: string[]) => {
    if (
      (failure === checkServer[0] && args.includes("--check")) ||
      (failure === "build" && args.includes("pnpm run build"))
    ) {
      throw new Error("release step failed");
    }
  });
  expect(() => releaseSelfHostedDesktop([], "win32")).toThrow("release step failed");
  expect(run.mock.calls.map(([, args]) => args)).not.toContainEqual(upload);
});

it("publishes only macOS artifacts when invoked on a Mac", () => {
  releaseSelfHostedDesktop([], "darwin");
  expect(run.mock.calls.map(([, args]) => args)).toEqual([
    ["dev_tools/check-update-publish.js", "--mac", "--config-only"],
    ["dev_tools/upload-update.js", "--mac", "--check"],
    ["run", "build"],
    ["dev_tools/upload-update.js", "--mac"],
    ["dev_tools/verify-update-manifest.js", "--mac", "--version", pkg.version],
  ]);
  expect(checkArtifacts).toHaveBeenCalledWith(expect.any(String), pkg.version, "mac");
});
