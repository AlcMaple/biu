const repositoryPattern = /^[a-z\d][a-z\d-]*\/[a-z\d._-]+$/i;
const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export function validateGitHubRepository(repository) {
  if (
    typeof repository !== "string" ||
    !repositoryPattern.test(repository) ||
    [".", ".."].includes(repository.split("/")[1])
  ) {
    throw new Error("GitHub 仓库必须为 owner/repo 格式");
  }
  return repository;
}

export function getGitHubReleaseTag(platform, version) {
  if (!["win", "mac"].includes(platform) || !stableVersion.test(version)) {
    throw new Error("桌面发布需要 Windows 或 macOS 平台和稳定版本号（如 2.8.1）");
  }
  return `biu-${platform}-v${version}`;
}

export function getGitHubReleaseVersion(platform, tag) {
  const prefix = `biu-${platform}-v`;
  if (typeof tag !== "string" || !tag.startsWith(prefix)) return null;
  const version = tag.slice(prefix.length);
  return stableVersion.test(version) ? version : null;
}

export function getGitHubReleaseAssetBase(repository, tag) {
  if (!getGitHubReleaseVersion("win", tag) && !getGitHubReleaseVersion("mac", tag)) {
    throw new Error("GitHub 桌面发布标签无效");
  }
  return new URL(`https://github.com/${validateGitHubRepository(repository)}/releases/download/${tag}/`);
}

export async function findWindowsReleaseTag(repository, requestPage) {
  const url = new URL(`https://api.github.com/repos/${validateGitHubRepository(repository)}/releases`);
  const perPage = 100;
  url.searchParams.set("per_page", String(perPage));
  let highestVersion = null;
  for (let page = 1; ; page++) {
    url.searchParams.set("page", String(page));
    const releases = JSON.parse((await requestPage(url)) ?? "null");
    if (!Array.isArray(releases)) throw new Error("GitHub 返回的发行版列表无效");
    // Latest 可能指向 macOS；并行发布也可能使较小版本排在较大版本前面。
    for (const release of releases) {
      if (release?.draft !== false || release.prerelease !== false) continue;
      const version = getGitHubReleaseVersion("win", release.tag_name);
      if (version && (!highestVersion || version.localeCompare(highestVersion, "en", { numeric: true }) > 0)) {
        highestVersion = version;
      }
    }
    if (releases.length < perPage) return highestVersion ? getGitHubReleaseTag("win", highestVersion) : null;
  }
}
