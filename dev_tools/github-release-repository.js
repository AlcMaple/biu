import { execFileSync } from "node:child_process";

import { validateGitHubRepository } from "../shared/github-release.js";

export function parseGitHubRemote(remote) {
  const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+?)\/?$/i.exec(
    remote,
  );
  if (!match) throw new Error("请将 git origin 设为自己的 github.com 仓库（HTTPS 或 SSH）");
  return validateGitHubRepository(match[1].replace(/\.git$/i, ""));
}

export function getGitHubReleaseRepository(cwd = process.cwd()) {
  function getUrls(push) {
    try {
      return execFileSync("git", ["remote", "get-url", ...(push ? ["--push"] : []), "--all", "origin"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
        .trim()
        .split(/\r?\n/)
        .map(parseGitHubRemote);
    } catch (error) {
      if (error instanceof Error && !("status" in error)) throw error;
      throw new Error("无法读取 git origin，请从自己的 GitHub 仓库克隆后运行");
    }
  }
  const repositories = [...getUrls(false), ...getUrls(true)];
  if (repositories.some(name => name.toLowerCase() !== repositories[0].toLowerCase())) {
    throw new Error("git origin 的读取和推送地址须指向同一个 GitHub 仓库");
  }
  return repositories[0];
}
