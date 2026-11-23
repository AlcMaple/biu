import type { ResolvedUpdateFileInfo, UpdateInfo } from "electron-updater";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider";

import { Provider } from "electron-updater";

import { findWindowsReleaseTag, getGitHubReleaseAssetBase, getGitHubReleaseTag } from "../../shared/github-release.js";
import {
  getWindowsUpdateManifestFilename,
  normalizeUpdateOrigin,
  resolveTrustedUpdateInstallerUrl,
  verifySignedUpdateEnvelope,
} from "../../shared/update-signing.js";

type SignedUpdatePublishOptions = {
  provider: "custom";
  url: string;
  repository?: string;
  trust: { keyId: string; publicKeyBase64: string };
};

function getCurrentWindowsArchitecture() {
  if (process.arch === "x64" || process.arch === "arm64") return process.arch;
  throw new Error(`不支持当前 Windows 架构 ${process.arch} 的自动更新`);
}

export class SignedUpdateProvider extends Provider<UpdateInfo> {
  private readonly baseUrl: URL;
  private readonly manifestName: string;

  constructor(
    private readonly options: SignedUpdatePublishOptions,
    _updater: unknown,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(runtimeOptions);
    this.baseUrl = normalizeUpdateOrigin(options.url);
    this.manifestName = getWindowsUpdateManifestFilename(getCurrentWindowsArchitecture());
  }

  async getLatestVersion(): Promise<UpdateInfo> {
    const repository = this.options.repository;
    let tag: string | null = null;
    if (repository) {
      tag = await findWindowsReleaseTag(repository, (url: URL) =>
        this.httpRequest(url, { accept: "application/vnd.github+json", "User-Agent": "Biu-Updater" }),
      );
      if (!tag) throw new Error("此仓库尚未发布稳定版 Windows 安装包");
    }
    const manifestUrl = new URL(
      this.manifestName,
      repository && tag ? getGitHubReleaseAssetBase(repository, tag) : this.baseUrl,
    );
    manifestUrl.searchParams.set("noCache", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const rawManifest = await this.httpRequest(manifestUrl, { accept: "application/json" });
    const metadata = verifySignedUpdateEnvelope(rawManifest ?? "", this.options.trust);
    if (metadata.arch !== getCurrentWindowsArchitecture()) {
      throw new Error("更新清单架构与当前应用不匹配");
    }
    if (tag && getGitHubReleaseTag("win", metadata.version) !== tag)
      throw new Error("签名清单的版本与 GitHub 标签不一致");
    return metadata as UpdateInfo;
  }

  resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    const file = updateInfo.files?.[0];
    if (!file) throw new Error("已验证的更新清单缺少安装包");
    const base = this.options.repository
      ? getGitHubReleaseAssetBase(this.options.repository, getGitHubReleaseTag("win", updateInfo.version))
      : this.baseUrl;
    return [{ url: resolveTrustedUpdateInstallerUrl(base, file.url), info: file }];
  }
}
