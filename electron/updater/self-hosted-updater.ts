import type { ResolvedUpdateFileInfo } from "electron-updater";
import type { DownloadUpdateOptions } from "electron-updater/out/AppUpdater";

import electronUpdater from "electron-updater";
import path from "node:path";

import { downloadInstaller } from "./download-installer";
import { reuseInstallerBlocks } from "./reuse-installer";

export class SelfHostedUpdater extends electronUpdater.NsisUpdater {
  constructor(private readonly publicKey: string) {
    super();
  }

  // NSIS 在此钩子前检查缓存，返回 false 后继续原有的签名验证和安装流程。
  protected override async differentialDownloadInstaller(
    file: ResolvedUpdateFileInfo,
    options: DownloadUpdateOptions,
    destination: string,
  ) {
    const size = file.info.size;
    if (!size || size < 4 * 1024 * 1024) return true;
    const headers = new Headers();
    for (const [key, value] of Object.entries(options.requestHeaders)) {
      if (value !== undefined) headers.set(key, String(value));
    }
    const session = this.netSession;
    const cacheDir = this.downloadedUpdateHelper?.cacheDir;
    const currentInstaller = `Biu-${this.currentVersion.version}-win-setup-${process.arch}.exe`;
    const downloaded = await downloadInstaller({
      size,
      sha512: file.info.sha512,
      destination,
      cancellationToken: options.cancellationToken,
      reuse: cacheDir
        ? (target, signal) =>
            reuseInstallerBlocks({
              cachedInstaller: path.join(cacheDir, "installer.exe"),
              target,
              signal,
              size,
              sha512: file.info.sha512,
              publicKey: this.publicKey,
              log: this._logger,
              requestIndex: version => {
                const name = version === "latest" ? file.info.url : currentInstaller;
                return session.fetch(new URL(`${name}.blockmap.signed`, file.url).href, {
                  headers,
                  redirect: "error",
                  signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
                });
              },
            })
        : undefined,
      onProgress: progress => this.emit("download-progress", progress),
      request: (range, signal) => {
        const partHeaders = new Headers(headers);
        partHeaders.set("Range", range);
        return session.fetch(file.url.href, { headers: partHeaders, redirect: "error", signal });
      },
    });
    return !downloaded;
  }
}
