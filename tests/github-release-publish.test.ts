import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { publishGitHubUpdate } from "../dev_tools/publish-github-update.js";
import {
  getUpdateSigningTrust,
  getWindowsUpdateManifestFilename,
  verifySignedUpdateEnvelope,
} from "../shared/update-signing.js";

const repository = "example/my-fork";
const commit = "a".repeat(40);
const version = "2.9.1";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const trust = getUpdateSigningTrust(publicKey.export({ format: "der", type: "spki" }).toString("base64"));
const signer = { privateKey, ...trust };
let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "biu # release-"));
  fs.writeFileSync(path.join(directory, "notes.md"), "本版更新");
});

afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

function makeBuild(platform: "win" | "mac") {
  const filenames = ["x64", "arm64"].flatMap(arch =>
    platform === "win"
      ? [
          `Biu-${version}-win-setup-${arch}.exe`,
          `Biu-${version}-win-setup-${arch}.exe.blockmap`,
          `Biu-${version}-win-portable-${arch}.exe`,
        ]
      : [`Biu-${version}-mac-${arch}.zip`, `Biu-${version}-mac-${arch}.dmg`],
  );
  for (const filename of filenames) fs.writeFileSync(path.join(directory, filename), filename);
  fs.writeFileSync(path.join(directory, platform === "mac" ? "latest-mac.yml" : "latest.yml"), `version: ${version}\n`);
  return {
    artifactsDir: directory,
    commit,
    notesFile: path.join(directory, "notes.md"),
    platform,
    repository,
    signer: platform === "win" ? signer : undefined,
    version,
  };
}

it("attaches both signed installers and portable builds to one release for the fork at the exact commit", async () => {
  const config = makeBuild("win");
  const gh = vi.fn((args: string[], cwd: string) => {
    if (args[0] === "api") return "";
    expect(args.slice(0, 7)).toEqual([
      "release",
      "create",
      "biu-win-v2.9.1",
      "--repo",
      "github.com/example/my-fork",
      "--target",
      commit,
    ]);
    expect(args).toContain(config.notesFile);
    const assets = args.slice(args.indexOf("--") + 1);
    expect(assets).toHaveLength(9);
    for (const arch of ["x64", "arm64"]) {
      const filename = `Biu-${version}-win-setup-${arch}.exe`;
      expect(assets).toContain(filename);
      expect(assets).toContain(`Biu-${version}-win-portable-${arch}.exe`);
      const manifest = assets.find(name => path.basename(name) === getWindowsUpdateManifestFilename(arch));
      const metadata = verifySignedUpdateEnvelope(fs.readFileSync(path.join(cwd, manifest!)), trust);
      expect(metadata).toMatchObject({
        arch,
        version,
        path: filename,
        releaseNotes: "本版更新",
        files: [
          {
            url: filename,
            size: Buffer.byteLength(filename),
            sha512: createHash("sha512").update(filename).digest("base64"),
          },
        ],
      });
    }
    return "";
  });
  await expect(publishGitHubUpdate(config, gh)).resolves.toBe(
    "https://github.com/example/my-fork/releases/tag/biu-win-v2.9.1",
  );
  expect(gh).toHaveBeenCalledTimes(2);
  expect(fs.readdirSync(directory).some(name => name.startsWith(".biu-manifests-"))).toBe(false);
});

it("publishes both macOS architectures under their own tag without a Windows signing key", async () => {
  makeBuild("win");
  const config = makeBuild("mac");
  const gh = vi.fn(() => "");
  await expect(publishGitHubUpdate(config, gh)).resolves.toContain("/tag/biu-mac-v2.9.1");
  expect(gh).toHaveBeenCalledWith(
    expect.arrayContaining(["latest-mac.yml", "Biu-2.9.1-mac-arm64.dmg", "Biu-2.9.1-mac-x64.dmg"]),
    directory,
  );
  expect(gh).not.toHaveBeenCalledWith(expect.arrayContaining(["latest.yml"]), directory);
});

it("rejects a missing architecture or stale metadata before reaching GitHub", async () => {
  const config = makeBuild("win");
  const gh = vi.fn(() => "");
  const arm = path.join(directory, "Biu-2.9.1-win-setup-arm64.exe");
  fs.unlinkSync(arm);
  await expect(publishGitHubUpdate(config, gh)).rejects.toThrow("win-setup-arm64.exe");
  fs.writeFileSync(arm, "arm64");
  fs.writeFileSync(path.join(directory, "latest.yml"), "version: 2.9.0");
  await expect(publishGitHubUpdate(config, gh)).rejects.toThrow("版本与 package.json 不一致");
  expect(gh).not.toHaveBeenCalled();
});

it("stops when an existing tag points to another commit", async () => {
  const config = makeBuild("mac");
  const gh = vi.fn((args: string[]) => {
    if (args.includes(".[].ref")) return "refs/tags/biu-mac-v2.9.1";
    if (args.includes(".sha")) return "b".repeat(40);
    throw new Error("unexpected release creation");
  });
  await expect(publishGitHubUpdate(config, gh)).rejects.toThrow("指向另一个提交");
  expect(gh).toHaveBeenCalledTimes(2);
});

it("surfaces upload failures without issuing another write and releases temporary manifests", async () => {
  const config = makeBuild("win");
  const gh = vi.fn((args: string[]) => {
    if (args[0] === "release") throw new Error("upload failed");
    return "";
  });
  await expect(publishGitHubUpdate(config, gh)).rejects.toThrow("upload failed");
  expect(gh).toHaveBeenCalledTimes(2);
  expect(fs.readdirSync(directory).some(name => name.startsWith(".biu-manifests-"))).toBe(false);
});
