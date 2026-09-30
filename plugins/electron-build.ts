import { logger } from "@rsbuild/core";
import { build as electronBuild } from "electron-builder";
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";

import pkg from "../package.json";
import { ELECTRON_OUT_DIRNAME, ELECTRON_ICON_BASE_PATH } from "../shared/path";
import { UPDATE_SIGNING_KEY_ID } from "../shared/update-signing-public-key.js";

function getElectronCacheDir() {
  if (process.env.ELECTRON_CACHE) return process.env.ELECTRON_CACHE;
  if (process.platform === "win32")
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "electron", "Cache");
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "electron");
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "electron");
}

function readAt(fd: number, position: number, length: number) {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, buf, done, length - done, position + done);
    if (n === 0) throw new Error("unexpected EOF");
    done += n;
  }
  return buf;
}

/** 纯 Node 校验 zip：读中央目录，逐个条目解压并比对大小与 CRC32（跨平台，不依赖 unzip）。 */
function isZipIntact(file: string) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = readAt(fd, size - tailLen, tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) return false;

    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return true; // zip64，不校验
    if (cdOffset + cdSize > size) return false;

    const cd = readAt(fd, cdOffset, cdSize);
    let pos = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(pos) !== 0x02014b50) return false;
      const method = cd.readUInt16LE(pos + 10);
      const crc = cd.readUInt32LE(pos + 16);
      const compressedSize = cd.readUInt32LE(pos + 20);
      const uncompressedSize = cd.readUInt32LE(pos + 24);
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      const localOffset = cd.readUInt32LE(pos + 42);
      pos += 46 + nameLen + extraLen + commentLen;

      const local = readAt(fd, localOffset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50) return false;
      const dataStart = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (dataStart + compressedSize > size) return false;

      const raw = compressedSize ? readAt(fd, dataStart, compressedSize) : Buffer.alloc(0);
      const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
      if (method !== 0 && method !== 8) continue;
      if (data.length !== uncompressedSize) return false;
      if (typeof zlib.crc32 === "function" && zlib.crc32(data) !== crc) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

/**
 * 缓存的 Electron 预编译 zip 若下载中断/损坏，electron-builder 会静默解压出残缺目录，
 * 最终报出难以理解的 "ENOENT rename Electron -> Biu"。打包前先校验，损坏的删掉让其重新下载。
 */
function purgeCorruptElectronCache() {
  const dir = getElectronCacheDir();
  if (!existsSync(dir)) return;

  for (const name of readdirSync(dir)) {
    if (!name.startsWith(`electron-v${pkg.devDependencies.electron}-`) || !name.endsWith(".zip")) continue;
    const file = join(dir, name);
    if (!isZipIntact(file)) {
      logger.warn(`[electron] Cached ${name} is corrupt, deleting so it gets re-downloaded`);
      rmSync(file, { force: true });
    }
  }
}

export async function buildElectron() {
  purgeCorruptElectronCache();
  await electronBuild({
    publish: "onTag",
    config: {
      appId: "com.biu.wood3n",
      productName: "Biu",
      copyright: `Copyright © ${new Date().getFullYear()}`,
      nodeVersion: "current",
      buildVersion: pkg.version,
      extraMetadata: {
        // 运行时仅在内置 Ed25519 公钥与此标识匹配时启用自动更新。
        biuUpdateTrust: { keyId: UPDATE_SIGNING_KEY_ID, mode: "ed25519" },
      },
      asar: true,
      electronCompile: false,
      compression: "maximum",
      removePackageScripts: true,
      removePackageKeywords: true,
      npmRebuild: false,
      nodeGypRebuild: false,
      buildDependenciesFromSource: false,
      electronLanguages: ["zh-CN"],
      directories: {
        output: "dist/artifacts",
      },
      extraResources: [{ from: ELECTRON_ICON_BASE_PATH, to: ELECTRON_ICON_BASE_PATH }],
      files: [`${ELECTRON_OUT_DIRNAME}/**`, "dist/web/**"],
      win: {
        target: [
          { target: "nsis", arch: ["x64", "arm64"] },
          { target: "portable", arch: ["x64", "arm64"] },
        ],
        icon: `${ELECTRON_ICON_BASE_PATH}/logo.ico`,
        extraResources: [{ from: "electron/ffmpeg/ffmpeg.exe", to: "electron/ffmpeg/ffmpeg.exe" }],
      },
      nsis: {
        deleteAppDataOnUninstall: true,
        oneClick: false,
        perMachine: false,
        allowElevation: true,
        allowToChangeInstallationDirectory: true,
        buildUniversalInstaller: false,
        artifactName: "${productName}-${version}-win-setup-${arch}.${ext}",
      },
      portable: {
        artifactName: "${productName}-${version}-win-portable-${arch}.${ext}",
      },
      mac: {
        target: [
          { target: "dmg", arch: ["x64", "arm64"] },
          { target: "zip", arch: ["x64", "arm64"] },
        ],
        category: "public.app-category.music",
        icon: `${ELECTRON_ICON_BASE_PATH}/logo.png`,
        hardenedRuntime: true,
        gatekeeperAssess: false,
        darkModeSupport: true,
        entitlements: "plugins/mac/entitlements.mac.plist",
        entitlementsInherit: "plugins/mac/entitlements.mac.plist",
        notarize: false,
        artifactName: "${productName}-${version}-mac-${arch}.${ext}",
        extraResources: [{ from: "electron/ffmpeg/ffmpeg-mac-${arch}", to: "electron/ffmpeg/ffmpeg-mac-${arch}" }],
      },
      linux: {
        target: [
          { target: "AppImage", arch: ["x64", "arm64"] },
          { target: "deb", arch: ["x64", "arm64"] },
          { target: "rpm", arch: ["x64", "arm64"] },
        ],
        icon: `${ELECTRON_ICON_BASE_PATH}/logo.png`,
        category: "AudioVideo",
        synopsis: "Biu - bilibili music desktop application",
        maintainer: "wood3n",
        vendor: "wood3n",
        executableName: "Biu",
        artifactName: "${productName}-${version}-linux-${arch}.${ext}",
        extraResources: [{ from: "electron/ffmpeg/ffmpeg-linux", to: "electron/ffmpeg/ffmpeg-linux" }],
      },
      publish: {
        provider: "generic",
        url: "https://biu.alcmaple.cn/biu/updates/",
      },
    },
  })
    .then(result => {
      logger.success(result);
    })
    .catch(error => {
      logger.error(error);
      throw error;
    });
}
