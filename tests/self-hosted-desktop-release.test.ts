import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { releaseSelfHostedDesktop } from "../dev_tools/release-self-hosted-desktop.js";
import pkg from "../package.json";

const run = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ default: { execFileSync: run }, execFileSync: run }));
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
});

it("builds for the original site and verifies both published Windows architectures", () => {
  releaseSelfHostedDesktop([], "win32");
  expect(run.mock.calls.map(([, args]) => args)).toEqual([
    checkConfig,
    checkServer,
    ["/d", "/c", "pnpm run build"],
    ["dev_tools/check-update-publish.js", "--win"],
    upload,
    ["dev_tools/verify-update-manifest.js", "--x64", "--version", pkg.version],
    ["dev_tools/verify-update-manifest.js", "--arm64", "--version", pkg.version],
  ]);
  for (const [, , { env }] of run.mock.calls) {
    expect(env.BIU_TARGET).toBe("electron");
    expect(env.BIU_UPDATE_PUBLIC_ORIGIN).toBe("https://updates.example.com/biu/");
    expect(env).not.toHaveProperty("BIU_GITHUB_RELEASE_REPO");
    expect(env).not.toHaveProperty("BIU_GITHUB_UPDATE_PUBLIC_KEY");
  }
});

it.each([checkServer[0], "build", "artifacts"])("stops before uploading after %s fails", failure => {
  run.mockImplementation((_command, args: string[]) => {
    if (
      (failure === checkServer[0] && args.includes("--check")) ||
      (failure === "build" && args.includes("pnpm run build")) ||
      (failure === "artifacts" && args[0] === checkConfig[0] && args.length === 2)
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
    ["dev_tools/check-update-publish.js", "--mac"],
    ["dev_tools/upload-update.js", "--mac"],
    ["dev_tools/verify-update-manifest.js", "--mac", "--version", pkg.version],
  ]);
});
