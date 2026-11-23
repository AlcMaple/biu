import { getGitHubReleaseRepository } from "../dev_tools/github-release-repository.js";
import { loadUpdateEnvironment } from "../dev_tools/update-env.js";
import { validateGitHubRepository } from "../shared/github-release.js";
import * as selfHostedSigning from "../shared/update-signing-public-key.js";
import { getUpdateSigningTrust, normalizeUpdateOrigin } from "../shared/update-signing.js";

export function getDesktopUpdateBuildConfig({
  environment = process.env,
  platform = process.platform,
  getRepository = getGitHubReleaseRepository,
  homeDirectory,
}: {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  getRepository?: () => string;
  homeDirectory?: string;
} = {}) {
  if (environment.BIU_GITHUB_RELEASE_REPO !== undefined) {
    const repository = validateGitHubRepository(environment.BIU_GITHUB_RELEASE_REPO);
    const trust = platform === "win32" ? getUpdateSigningTrust(environment.BIU_GITHUB_UPDATE_PUBLIC_KEY) : null;
    return { repository, url: `https://github.com/${repository}/releases/`, trust };
  }

  const releaseEnv = { ...environment };
  loadUpdateEnvironment({ environment: releaseEnv, homeDirectory });
  let origin = releaseEnv.BIU_UPDATE_PUBLIC_ORIGIN?.trim();
  if (!origin) {
    // 普通 fork 构建和源码压缩包都不能继承官方仓库的更新通道。
    let repository: string;
    try {
      repository = getRepository();
    } catch {
      return null;
    }
    if (repository.toLowerCase() !== "alcmaple/biu") return null;
    origin = "https://biu.alcmaple.cn/biu/updates/";
  }
  return {
    url: normalizeUpdateOrigin(origin).href,
    trust: {
      keyId: selfHostedSigning.UPDATE_SIGNING_KEY_ID,
      publicKeyBase64: selfHostedSigning.UPDATE_SIGNING_PUBLIC_KEY_BASE64,
    },
  };
}
