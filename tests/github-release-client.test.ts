import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider";

import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getGitHubReleaseRepository, parseGitHubRemote } from "../dev_tools/github-release-repository.js";
import { SignedUpdateProvider } from "../electron/updater/signed-provider";
import { getDesktopUpdateBuildConfig } from "../plugins/desktop-update-config";
import { buildElectron } from "../plugins/electron-build";
import {
  createSignedUpdateEnvelope,
  createWindowsUpdateMetadata,
  getUpdateSigningTrust,
} from "../shared/update-signing.js";

const packageApp = vi.hoisted(() => vi.fn());
vi.mock("electron-builder", () => ({ build: packageApp }));
vi.mock("@rsbuild/core", () => ({ logger: { success: vi.fn() } }));
vi.mock("../plugins/win-code-sign", () => ({ prepareWinCodeSign: vi.fn() }));

const repository = "Example-Owner/my_biu";
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const trust = getUpdateSigningTrust(publicKey);
const environment = { BIU_GITHUB_RELEASE_REPO: repository, BIU_GITHUB_UPDATE_PUBLIC_KEY: publicKey };
const arch = process.arch;
const version = "2.10.1";
const file = `Biu-${version}-win-setup-${arch}.exe`;
const manifest = arch === "arm64" ? "latest-arm64.json" : "latest.json";
const metadata = createWindowsUpdateMetadata({
  arch,
  filename: file,
  releaseDate: new Date().toISOString(),
  releaseNotes: "",
  sha512: Buffer.alloc(64, 9).toString("base64"),
  size: 1234,
  version,
});
const signed = createSignedUpdateEnvelope(metadata, keys.privateKey, trust);

function testProvider(request: ReturnType<typeof vi.fn>, selfHosted = false) {
  return new SignedUpdateProvider(
    {
      provider: "custom",
      url: selfHosted ? "https://updates.example.org/biu/" : `https://github.com/${repository}/releases/`,
      repository: selfHosted ? undefined : repository,
      trust,
    },
    null,
    { executor: { request }, platform: "win32", isUseMultipleRangeRequest: false } as unknown as ProviderRuntimeOptions,
  );
}

describe("GitHub desktop release channel", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("packages the release repository and trust identifier without allowing electron-builder to publish", async () => {
    vi.stubEnv("BIU_GITHUB_RELEASE_REPO", repository);
    vi.stubEnv("BIU_GITHUB_UPDATE_PUBLIC_KEY", publicKey);
    const cache = mkdtempSync(join(tmpdir(), "biu-test-electron-cache-"));
    try {
      vi.stubEnv("ELECTRON_CACHE", cache);
      packageApp.mockResolvedValue([]);
      await buildElectron();
      expect(packageApp).toHaveBeenCalledWith(
        expect.objectContaining({
          publish: "never",
          config: expect.objectContaining({
            publish: { provider: "generic", url: `https://github.com/${repository}/releases/` },
            extraMetadata: {
              biuUpdateTrust: process.platform === "win32" ? { mode: "ed25519", keyId: trust.keyId } : null,
            },
          }),
        }),
      );
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("reads a GitHub origin independent of package metadata and rejects conflicting push URLs", () => {
    const cwd = mkdtempSync(join(tmpdir(), "biu-github-origin-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd });
      execFileSync("git", ["remote", "add", "origin", `git@github.com:${repository}.git`], { cwd });
      expect(getGitHubReleaseRepository(cwd)).toBe(repository);
      execFileSync("git", ["remote", "set-url", "--push", "origin", "https://github.com/example/somewhere-else.git"], {
        cwd,
      });
      expect(() => getGitHubReleaseRepository(cwd)).toThrow(/同一个/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
    expect(parseGitHubRemote(`https://github.com/${repository}.git`)).toBe(repository);
    expect(parseGitHubRemote(`ssh://git@github.com/${repository}`)).toBe(repository);
    for (const remote of [
      "https://github.com.invalid/o/r",
      "https://github.com/o/..",
      "https://token@github.com/o/r",
      "git@github.com:o/r/extra",
    ]) {
      expect(() => parseGitHubRemote(remote)).toThrow();
    }
  });

  it("builds a fork-specific trust root with GitHub settings taking priority over legacy settings", () => {
    const config = getDesktopUpdateBuildConfig({
      platform: "win32",
      environment: { ...environment, BIU_UPDATE_PUBLIC_ORIGIN: "invalid" },
    });
    expect(config).toEqual({ repository, url: `https://github.com/${repository}/releases/`, trust });
    expect(() =>
      getDesktopUpdateBuildConfig({ platform: "win32", environment: { BIU_GITHUB_RELEASE_REPO: repository } }),
    ).toThrow();
    expect(
      getDesktopUpdateBuildConfig({ platform: "darwin", environment: { BIU_GITHUB_RELEASE_REPO: repository } })?.trust,
    ).toBeNull();
    const homeDirectory = mkdtempSync(join(tmpdir(), "biu-update-build-"));
    try {
      expect(
        getDesktopUpdateBuildConfig({ environment: {}, getRepository: () => repository, homeDirectory }),
      ).toBeNull();
      expect(
        getDesktopUpdateBuildConfig({ environment: {}, getRepository: () => "AlcMaple/biu", homeDirectory })?.url,
      ).toBe("https://biu.alcmaple.cn/biu/updates/");
      expect(
        getDesktopUpdateBuildConfig({
          environment: { BIU_UPDATE_PUBLIC_ORIGIN: "https://updates.example.org" },
          getRepository: () => repository,
          homeDirectory,
        })?.url,
      ).toBe("https://updates.example.org/");
    } finally {
      rmSync(homeDirectory, { recursive: true, force: true });
    }
  });

  it("follows Windows releases across pages and downloads from the exact tag verified by the manifest", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify(
          Array.from({ length: 100 }, (_, index) => ({
            tag_name: index === 0 ? "biu-win-v2.9.99" : "biu-mac-v3.0.0",
            draft: false,
            prerelease: false,
          })),
        ),
      )
      .mockResolvedValueOnce(
        JSON.stringify([
          { tag_name: "biu-win-v3.0.1", draft: true, prerelease: false },
          { tag_name: "biu-win-v3.0.0", draft: false, prerelease: true },
          { tag_name: "v2.8.2", draft: false, prerelease: false },
          { tag_name: "biu-win-v2.10.1", draft: false, prerelease: false },
          { tag_name: "biu-win-v2.6.10", draft: false, prerelease: false },
        ]),
      )
      .mockResolvedValueOnce(signed);
    const provider = testProvider(request);
    const update = await provider.getLatestVersion();
    const requests = request.mock.calls.map(([options]) => new URL(`https://${options.hostname}${options.path}`));
    expect(requests[0].origin + requests[0].pathname).toBe(`https://api.github.com/repos/${repository}/releases`);
    expect(requests[1].searchParams.get("page")).toBe("2");
    const base = `https://github.com/${repository}/releases/download/biu-win-v2.10.1/`;
    expect(requests[2].origin + requests[2].pathname).toBe(base + manifest);
    expect(provider.resolveFiles(update)[0].url.href).toBe(base + file);
  });

  it("rejects a valid signature for another version and a matching tag signed by a different key", async () => {
    const tag = (version: string) =>
      JSON.stringify([{ tag_name: `biu-win-v${version}`, draft: false, prerelease: false }]);
    await expect(
      testProvider(vi.fn().mockResolvedValueOnce(tag("2.8.2")).mockResolvedValueOnce(signed)).getLatestVersion(),
    ).rejects.toThrow(/版本/);
    const foreign = createSignedUpdateEnvelope(metadata, generateKeyPairSync("ed25519").privateKey, trust);
    await expect(
      testProvider(vi.fn().mockResolvedValueOnce(tag(version)).mockResolvedValueOnce(foreign)).getLatestVersion(),
    ).rejects.toThrow(/签名校验失败/);
  });

  it("keeps self-hosted manifests and installers in the configured HTTPS directory", async () => {
    const request = vi.fn().mockResolvedValueOnce(signed);
    const provider = testProvider(request, true);
    const update = await provider.getLatestVersion();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      hostname: "updates.example.org",
      path: expect.stringContaining("/biu/" + manifest),
    });
    expect(provider.resolveFiles(update)[0].url.href).toBe("https://updates.example.org/biu/" + file);
  });
});
