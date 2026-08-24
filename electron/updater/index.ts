import { app, BrowserWindow } from "electron";
import isDev from "electron-is-dev";
import log from "electron-log";
import electronUpdater, { type UpdateDownloadedEvent } from "electron-updater";
import { readFileSync } from "node:fs";
import path from "node:path";

import { UPDATE_SIGNING_KEY_ID } from "../../shared/update-signing-public-key.js";
import { channel } from "../ipc/channel";
import { SignedUpdateProvider } from "./signed-provider";

const { autoUpdater } = electronUpdater;
const UPDATE_PUBLIC_ORIGIN = "https://biu.alcmaple.cn/biu/updates/";

let checkForUpdatesInterval: NodeJS.Timeout | null = null;
let automaticUpdateDisabledReason: string | null = null;

function getAutomaticUpdateBuildReason() {
  if (process.platform !== "win32") {
    return "免费安全自动更新目前仅支持 Windows NSIS 安装版。";
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) {
    return "便携版不支持自动安装更新，请下载新的安装版。";
  }
  if (isDev) return null;

  try {
    const packageMetadata = JSON.parse(readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")) as {
      biuUpdateTrust?: { keyId?: unknown; mode?: unknown };
    };
    if (
      packageMetadata.biuUpdateTrust?.mode === "ed25519" &&
      packageMetadata.biuUpdateTrust.keyId === UPDATE_SIGNING_KEY_ID
    ) {
      return null;
    }
    return "当前安装包不含免费安全更新验证信息，请手动安装官方最新安装包。";
  } catch (error) {
    log.error("[updater] Unable to read packaged update security metadata", error);
    return "无法验证当前安装包的更新安全信息，已关闭自动更新。";
  }
}

export function getAutomaticUpdateDisabledReason() {
  return automaticUpdateDisabledReason;
}

function setupAutoUpdater({ getMainWindow }: { getMainWindow: () => BrowserWindow | null }) {
  const disabledReason = getAutomaticUpdateBuildReason();
  if (disabledReason) {
    automaticUpdateDisabledReason = disabledReason;
    log.warn(`[updater] ${automaticUpdateDisabledReason}`);
    return;
  }

  automaticUpdateDisabledReason = null;
  autoUpdater.logger = log;
  log.transports.file.level = "info";
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = true;
  // 免费个人通道不信任服务器上的 latest.yml 和差分 blockmap：
  // 只接受内置 Ed25519 公钥验证过的 JSON 清单，并对完整安装包校验 SHA-512。
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.disableWebInstaller = true;

  if (isDev) {
    autoUpdater.updateConfigPath = path.resolve(process.cwd(), "electron/updater/dev-app-update.yml");
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.autoRunAppAfterInstall = false;
  }

  try {
    const signedProviderConfig = {
      provider: "custom",
      url: UPDATE_PUBLIC_ORIGIN,
      updateProvider: SignedUpdateProvider,
    } as const;
    autoUpdater.setFeedURL(signedProviderConfig as Parameters<typeof autoUpdater.setFeedURL>[0]);
  } catch (error) {
    automaticUpdateDisabledReason = "无法建立受签名的更新通道，已关闭自动更新。";
    log.error("[updater] Unable to configure signed update provider", error);
    return;
  }

  autoUpdater.on("update-available", info => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(channel.app.onUpdateAvailable, {
      latestVersion: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("download-progress", progressObj => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(channel.app.updateMessage, {
      status: "downloading",
      processInfo: progressObj,
    });
  });

  autoUpdater.on("error", error => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(channel.app.updateMessage, {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateDownloadedEvent) => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(channel.app.updateMessage, {
      status: "downloaded",
      downloadInfo: {
        filePath: info.downloadedFile,
      },
    });
  });

  const checkForUpdates = () => {
    void autoUpdater.checkForUpdates().catch(error => {
      log.warn("[updater] Background update check failed", error);
    });
  };

  checkForUpdates();
  checkForUpdatesInterval = setInterval(checkForUpdates, 1 * 60 * 60 * 1000);
}

const stopCheckForUpdates = () => {
  if (checkForUpdatesInterval) {
    clearInterval(checkForUpdatesInterval);
    checkForUpdatesInterval = null;
  }
};

export { autoUpdater, setupAutoUpdater, stopCheckForUpdates };
