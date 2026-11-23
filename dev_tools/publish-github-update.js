import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { getGitHubReleaseTag, validateGitHubRepository } from "../shared/github-release.js";
import { getDesktopReleaseArtifacts, writeSignedWindowsManifest } from "./update-artifacts.js";

const root = path.resolve(import.meta.dirname, "..");

function runGh(args, cwd) {
  return execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

export async function publishGitHubUpdate(
  {
    repository,
    commit,
    version,
    platform,
    signer,
    artifactsDir = path.join(root, "dist/artifacts"),
    notesFile = path.join(root, "dev_tools/release-notes.md"),
  },
  gh = runGh,
) {
  const tag = getGitHubReleaseTag(platform, version);
  validateGitHubRepository(repository);
  const assets = getDesktopReleaseArtifacts(artifactsDir, version, platform, { includePortable: true });
  const releaseNotes = fs.readFileSync(notesFile, "utf8").trim();
  const manifestDir = platform === "win" ? fs.mkdtempSync(path.join(artifactsDir, ".biu-manifests-")) : undefined;
  try {
    if (manifestDir) {
      if (!signer?.privateKey || !signer.keyId) throw new Error("Windows 发布需要本仓库的更新签名密钥。");
      const releaseDate = new Date().toISOString();
      for (const arch of ["x64", "arm64"]) {
        const { fullPath } = await writeSignedWindowsManifest({
          arch,
          directory: manifestDir,
          installerPath: path.join(artifactsDir, `Biu-${version}-win-setup-${arch}.exe`),
          releaseDate,
          releaseNotes,
          signer,
          version,
        });
        assets.push(path.relative(artifactsDir, fullPath));
      }
    }

    // GitHub 遇到已有 tag 会忽略 --target，因此先核对它最终指向的提交（包括 annotated tag）。
    const api = (endpoint, filter) =>
      gh(["api", "--hostname", "github.com", `repos/${repository}/${endpoint}`, "--jq", filter], artifactsDir);
    const refs = api(`git/matching-refs/tags/${tag}`, ".[].ref").split(/\r?\n/);
    if (refs.includes(`refs/tags/${tag}`) && api(`commits/${tag}`, ".sha") !== commit) {
      throw new Error(`远端标签 ${tag} 已指向另一个提交，请使用新的版本号。`);
    }

    // gh 在独立草稿中上传全部资产，全部成功后才公开。重跑不会替换已公开的安装包或签名。
    console.log(`正在发布 ${repository} 的 ${tag}，共 ${assets.length} 个文件。`);
    gh(
      [
        "release",
        "create",
        tag,
        "--repo",
        `github.com/${repository}`,
        "--target",
        commit,
        "--title",
        `Biu ${version} · ${platform === "win" ? "Windows" : "macOS"}`,
        "--notes-file",
        path.resolve(notesFile),
        "--",
        ...assets,
      ],
      artifactsDir,
    );
    return `https://github.com/${repository}/releases/tag/${tag}`;
  } finally {
    if (manifestDir) fs.rmSync(manifestDir, { recursive: true, force: true });
  }
}
