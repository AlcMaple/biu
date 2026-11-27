import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { getGitHubReleaseTag, getGitHubReleaseVersion } from "../shared/github-release.js";
import { prepareGitHubReleaseKey, verifyPreviousRelease } from "./github-release-key.js";
import { getGitHubReleaseRepository } from "./github-release-repository.js";
import * as windowsTrust from "./github-release-trust-tag.js";
import { publishGitHubUpdate } from "./publish-github-update.js";

const root = path.resolve(import.meta.dirname, "..");

function output(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function getReleaseCommit() {
  if (output("git", ["status", "--porcelain"])) {
    throw new Error("项目里还有未提交的改动。请先提交本次发版的文件并推送到自己的仓库。");
  }
  return output("git", ["rev-parse", "HEAD"]);
}

function checkGitHubAccess(repository, commit) {
  const info = JSON.parse(
    output("gh", ["repo", "view", `github.com/${repository}`, "--json", "nameWithOwner,viewerPermission,visibility"]),
  );
  if (info.nameWithOwner.toLowerCase() !== repository.toLowerCase()) {
    throw new Error("GitHub 上的仓库已更名，请将 git origin 更新为当前仓库地址。");
  }
  if (info.visibility !== "PUBLIC") throw new Error("桌面版用户需要公开下载更新，请使用自己的公开 GitHub 仓库。");
  if (!["WRITE", "MAINTAIN", "ADMIN"].includes(info.viewerPermission)) {
    throw new Error(`登录账号没有向 ${repository} 发布的权限，请核对 gh 登录账号和 git origin。`);
  }
  // GitHub 的 fork 网络共享提交对象，光能按 SHA 读取提交，无法证明它在这个仓库的分支上。
  const tips = output("gh", [
    "api",
    "--hostname",
    "github.com",
    "--paginate",
    `repos/${repository}/branches?per_page=100`,
    "--jq",
    ".[].commit.sha",
  ])
    .split(/\r?\n/)
    .filter(Boolean);
  if (tips.includes(commit)) return;
  for (const tip of tips) {
    try {
      output("git", ["merge-base", "--is-ancestor", commit, tip]);
      return;
    } catch (error) {
      if (error.status !== 1 && error.status !== 128) throw error;
    }
  }
  throw new Error(`无法确认 ${repository} 的分支包含本次提交。请先推送，若分支已前进请执行 git fetch origin 再检查。`);
}

function inspectPublishedVersion(repository, platform, version) {
  const tags = output("gh", [
    "api",
    "--hostname",
    "github.com",
    "--paginate",
    `repos/${repository}/releases?per_page=100`,
    "--jq",
    ".[] | select(.draft == false and .prerelease == false) | .tag_name",
  ]).split(/\r?\n/);
  const versions = tags.map(tag => getGitHubReleaseVersion(platform, tag)).filter(Boolean);
  const latest = versions.sort((a, b) => b.localeCompare(a, "en", { numeric: true }))[0];
  if (!latest) return null;
  if (version.localeCompare(latest, "en", { numeric: true }) <= 0) {
    throw new Error(`这个平台已经发布过 ${latest}。请在 package.json 中设置更高的版本号，提交并推送。`);
  }
  if (platform === "mac") return null;
  const manifest = output("gh", [
    "release",
    "download",
    getGitHubReleaseTag(platform, latest),
    "--repo",
    `github.com/${repository}`,
    "--pattern",
    "latest.json",
    "--output",
    "-",
  ]);
  return { manifest, version: latest };
}

function buildDesktop(platform, repository, signer) {
  const env = {
    ...process.env,
    BIU_TARGET: "electron",
    BIU_GITHUB_RELEASE_REPO: repository,
    BIU_GITHUB_UPDATE_PUBLIC_KEY: signer?.publicKeyBase64 ?? "",
  };
  if (platform === "win") {
    execFileSync("cmd.exe", ["/d", "/c", "pnpm run build"], { cwd: root, env, stdio: "inherit" });
  } else {
    execFileSync("pnpm", ["run", "build"], { cwd: root, env, stdio: "inherit" });
  }
}

export async function releaseDesktop(args, system = process.platform) {
  if (args.includes("--help")) {
    console.log(
      "pnpm release:desktop:github          构建并发布当前电脑平台到自己的 GitHub Releases\npnpm release:desktop:github --check  只检查发版条件",
    );
    return;
  }
  if (args.some(arg => arg !== "--check")) throw new Error("可用参数为 --check 或 --help。");
  if (!["win32", "darwin"].includes(system)) throw new Error("请在 Windows 或 macOS 上发布相应的桌面版。");
  const platform = system === "win32" ? "win" : "mac";
  const checkOnly = args.includes("--check");
  const repository = getGitHubReleaseRepository(root);
  const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const tag = getGitHubReleaseTag(platform, version);
  console.log(`发布目标：${repository} / ${tag}`);
  try {
    output("gh", ["--version"]);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const install =
      platform === "win" ? "winget install --id GitHub.cli -e" : "brew install gh（或从 https://cli.github.com 安装）";
    throw new Error(`请先安装 GitHub CLI：${install}。安装后重新打开项目目录的终端。`);
  }
  try {
    output("gh", ["auth", "status", "--active", "--hostname", "github.com"]);
  } catch (error) {
    throw new Error(
      `请运行 gh auth login --hostname github.com --web 完成登录，并确认能连接 GitHub。\n${error.message}`,
    );
  }
  const commit = getReleaseCommit();
  checkGitHubAccess(repository, commit);
  const previousRelease = inspectPublishedVersion(repository, platform, version);
  const signer =
    platform === "win"
      ? prepareGitHubReleaseKey({
          repository,
          previousRelease,
          checkOnly,
          registeredKey: windowsTrust.getRegisteredWindowsKey(repository),
        })
      : null;
  if (checkOnly) {
    console.log("发布条件检查通过。要开始构建并上传，请运行 pnpm release:desktop:github。");
    return;
  }
  buildDesktop(platform, repository, signer);
  if (getReleaseCommit() !== commit) throw new Error("构建期间当前提交已更改，请重新发布。");
  // 打包可能耗时数分钟，期间另一台电脑可能已经发布了更高版本或首次确立了签名密钥。
  const currentRelease = inspectPublishedVersion(repository, platform, version);
  if (currentRelease) verifyPreviousRelease(currentRelease, signer);
  if (signer) windowsTrust.registerWindowsKey(repository, commit, signer.publicKeyBase64);
  const url = await publishGitHubUpdate({ repository, commit, version, platform, signer });
  console.log(`已发布：${url}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  releaseDesktop(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
