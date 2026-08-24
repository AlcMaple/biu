import type { ResolvedUpdateFileInfo, UpdateInfo } from "electron-updater";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider";

import { Provider } from "electron-updater";

import {
  getWindowsUpdateManifestFilename,
  normalizeUpdateOrigin,
  resolveTrustedUpdateInstallerUrl,
  verifySignedUpdateEnvelope,
} from "../../shared/update-signing.js";

type SignedUpdatePublishOptions = {
  provider: "custom";
  url: string;
};

function getCurrentWindowsArchitecture() {
  if (process.arch === "x64" || process.arch === "arm64") return process.arch;
  throw new Error(`不支持当前 Windows 架构 ${process.arch} 的自动更新`);
}

export class SignedUpdateProvider extends Provider<UpdateInfo> {
  private readonly baseUrl: URL;
  private readonly manifestName: string;

  constructor(options: SignedUpdatePublishOptions, _updater: unknown, runtimeOptions: ProviderRuntimeOptions) {
    super(runtimeOptions);
    this.baseUrl = normalizeUpdateOrigin(options.url);
    this.manifestName = getWindowsUpdateManifestFilename(getCurrentWindowsArchitecture());
  }

  async getLatestVersion(): Promise<UpdateInfo> {
    const manifestUrl = new URL(this.manifestName, this.baseUrl);
    manifestUrl.searchParams.set("noCache", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const rawManifest = await this.httpRequest(manifestUrl, { accept: "application/json" });
    const metadata = verifySignedUpdateEnvelope(rawManifest ?? "");
    if (metadata.arch !== getCurrentWindowsArchitecture()) {
      throw new Error("更新清单架构与当前应用不匹配");
    }
    return metadata as UpdateInfo;
  }

  resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    const file = updateInfo.files?.[0];
    if (!file) throw new Error("已验证的更新清单缺少安装包");
    return [{ url: resolveTrustedUpdateInstallerUrl(this.baseUrl, file.url), info: file }];
  }
}
