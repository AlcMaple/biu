#!/usr/bin/env node
/**
 * 将已构建的更新包发布到受限 SFTP 账户
 *
 * 生产目标、账户和认证方式只能来自仓库外的私有环境配置：
 * BIU_UPDATE_PUBLISH_HOST / BIU_UPDATE_PUBLISH_USER / BIU_UPDATE_REMOTE_DIR /
 * BIU_UPDATE_PUBLIC_ORIGIN，以及 BIU_UPDATE_PUBLISH_KEY 或 SSH_AUTH_SOCK
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "ssh2";

import { writeSignedWindowsManifest } from "./update-artifacts.js";
import { loadUpdatePublishConfig, remoteFile, resolveSshAuth } from "./update-deploy-config.js";
import { loadUpdateEnvironment } from "./update-env.js";
import {
  checkRemotePublishDirectory,
  checkRemoteUpdateVersion,
  putFile,
  replaceRemoteFile,
  withRemotePublishLock,
} from "./update-sftp.js";
import { loadUpdateSigningPrivateKey } from "./update-signature.js";

loadUpdateEnvironment();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const ARTIFACTS_DIR = path.join(ROOT_DIR, "dist", "artifacts");
const RELEASE_NOTES_FILE = path.join(__dirname, "release-notes.md");

const releaseNotes = fs.existsSync(RELEASE_NOTES_FILE) ? fs.readFileSync(RELEASE_NOTES_FILE, "utf8").trim() : "";
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
const version = pkg.version;

const checkOnly = process.argv.includes("--check");
const args = process.argv.slice(2).filter(arg => arg !== "--check");
if (args.includes("--install-key")) {
  throw new Error("请由管理员通过私有运行手册为受限发布账户登记公钥");
}

const supportedFlags = new Set(["--win", "--mac", "--linux"]);
const unsupportedFlags = args.filter(arg => !supportedFlags.has(arg));
if (unsupportedFlags.length > 0) {
  throw new Error(`不支持的发布参数：${unsupportedFlags.join(", ")}`);
}

const noPlatformArg = args.length === 0;
const platforms = {
  linux: noPlatformArg || args.includes("--linux"),
  mac: noPlatformArg || args.includes("--mac"),
  win: noPlatformArg || args.includes("--win"),
};

const fileGroups = {
  win: [
    `Biu-${version}-win-setup-x64.exe`,
    `Biu-${version}-win-setup-x64.exe.blockmap`,
    `Biu-${version}-win-setup-arm64.exe`,
    `Biu-${version}-win-setup-arm64.exe.blockmap`,
    "latest.yml",
  ],
  mac: [
    `Biu-${version}-mac-arm64.dmg`,
    `Biu-${version}-mac-arm64.dmg.blockmap`,
    `Biu-${version}-mac-x64.dmg`,
    `Biu-${version}-mac-x64.dmg.blockmap`,
    `Biu-${version}-mac-arm64.zip`,
    `Biu-${version}-mac-x64.zip`,
    "latest-mac.yml",
  ],
  linux: [`Biu-${version}-linux-x64.AppImage`, `Biu-${version}-linux-arm64.AppImage`, "latest-linux.yml"],
};

function log(message) {
  console.log(message);
}

function connect(config, auth) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client
      .once("ready", () => resolve(client))
      .once("error", reject)
      .connect({ host: config.host, port: 22, readyTimeout: 10_000, username: config.user, ...auth });
  });
}

function openSftp(client) {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp)));
  });
}

function publicFileUrl(publicOrigin, filename) {
  const base = publicOrigin.endsWith("/") ? publicOrigin : `${publicOrigin}/`;
  return new URL(filename, base).toString();
}

function makeMetadataCopy(filename, sourcePath) {
  if (!releaseNotes || !filename.endsWith(".yml")) return { cleanup: () => {}, path: sourcePath };

  const original = fs.readFileSync(sourcePath, "utf8");
  const stripped = original.replace(/^releaseNotes:[\s\S]*?(?=^\w|\Z)/m, "").trimEnd();
  const indented = releaseNotes
    .split("\n")
    .map(line => `  ${line}`)
    .join("\n");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "biu-update-meta-"));
  const tempPath = path.join(directory, filename);
  fs.writeFileSync(tempPath, `${stripped}\nreleaseNotes: |\n${indented}\n`, "utf8");
  return { cleanup: () => fs.rmSync(directory, { force: true, recursive: true }), path: tempPath };
}

async function createSignedWindowsManifests(files, privateKey) {
  const releaseDate = new Date().toISOString();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "biu-signed-update-"));
  const manifests = [];

  try {
    for (const arch of ["x64", "arm64"]) {
      const filename = `Biu-${version}-win-setup-${arch}.exe`;
      const installer = files.find(file => file.platform === "win" && file.filename === filename);
      if (!installer) continue;

      const manifest = await writeSignedWindowsManifest({
        arch,
        directory,
        installerPath: installer.fullPath,
        releaseDate,
        releaseNotes,
        signer: { privateKey },
        version,
      });
      manifests.push(manifest);
    }

    if (manifests.length === 0) {
      throw new Error("缺少 Windows NSIS 安装包；免费自动更新只能发布 win-setup-*.exe");
    }
    return { cleanup: () => fs.rmSync(directory, { force: true, recursive: true }), manifests };
  } catch (error) {
    fs.rmSync(directory, { force: true, recursive: true });
    throw error;
  }
}

async function atomicPublish(sftp, localPath, filename, remoteDir, showProgress = false) {
  const temporaryPath = remoteFile(remoteDir, `${filename}.${randomUUID()}.tmp`);
  try {
    await putFile(sftp, localPath, temporaryPath, showProgress);
    await replaceRemoteFile(sftp, temporaryPath, remoteFile(remoteDir, filename));
  } catch (error) {
    try {
      await promisify(sftp.unlink.bind(sftp))(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 2) log(`清理上传临时文件失败：${cleanupError.message}`);
    }
    throw error;
  }
}

function collectArtifacts() {
  if (!fs.existsSync(ARTIFACTS_DIR)) throw new Error("未找到 dist/artifacts/；请先完成构建");

  const files = [];
  for (const [platform, enabled] of Object.entries(platforms)) {
    if (!enabled) continue;
    for (const filename of fileGroups[platform]) {
      const fullPath = path.join(ARTIFACTS_DIR, filename);
      if (fs.existsSync(fullPath)) files.push({ filename, fullPath, platform });
    }
  }
  if (!files.length) throw new Error(`dist/artifacts/ 中没有当前版本 ${version} 的可上传文件`);
  return files;
}

async function publishUpdates(sftp, config, files, signingKey) {
  const binaries = files.filter(file => !file.filename.endsWith(".yml"));
  const metadata = files.filter(file => file.filename.endsWith(".yml"));
  const signedWindowsManifests = signingKey ? await createSignedWindowsManifests(files, signingKey) : null;

  try {
    const totalBytes = binaries.reduce((sum, file) => sum + fs.statSync(file.fullPath).size, 0);
    log(`待上传 ${binaries.length} 个文件，共 ${(totalBytes / 1024 ** 2).toFixed(1)} MiB，传齐后发布更新清单。`);
    // 客户端读到新清单时，其中的安装包必须已经可以完整下载。
    for (const [index, file] of binaries.entries()) {
      log(`[${index + 1}/${binaries.length}] ${file.filename}`);
      await atomicPublish(sftp, file.fullPath, file.filename, config.remoteDir, true);
    }

    for (const file of metadata) {
      const copy = makeMetadataCopy(file.filename, file.fullPath);
      try {
        log(`原子发布 ${file.filename}`);
        await atomicPublish(sftp, copy.path, file.filename, config.remoteDir);
      } finally {
        copy.cleanup();
      }
    }

    for (const manifest of signedWindowsManifests?.manifests ?? []) {
      log(`原子发布受签名更新清单 ${manifest.filename}`);
      await atomicPublish(sftp, manifest.fullPath, manifest.filename, config.remoteDir);
    }

    log("已上传，更新地址如下。");
    for (const file of metadata) log(`  ${publicFileUrl(config.publicOrigin, file.filename)}`);
    for (const manifest of signedWindowsManifests?.manifests ?? []) {
      log(`  ${publicFileUrl(config.publicOrigin, manifest.filename)}`);
    }
  } finally {
    signedWindowsManifests?.cleanup();
  }
}

let client;
try {
  const config = loadUpdatePublishConfig();
  const auth = resolveSshAuth();
  const signingKey = platforms.win ? loadUpdateSigningPrivateKey() : null;
  const files = checkOnly ? [] : collectArtifacts();
  const pending = checkOnly
    ? Object.keys(platforms).filter(platform => platforms[platform])
    : [...new Set(files.map(file => file.platform))];
  client = await connect(config, auth);
  const sftp = await openSftp(client);
  await checkRemotePublishDirectory(sftp, config.remoteDir);
  const checkVersion = () => checkRemoteUpdateVersion(sftp, config.remoteDir, pending, version);
  if (checkOnly) {
    await checkVersion();
    log(`已登录 SFTP 并读取发布目录，目标版本 ${version} 通过版本检查。`);
  } else {
    await withRemotePublishLock(sftp, config.remoteDir, async () => {
      await checkVersion();
      await publishUpdates(sftp, config, files, signingKey);
    });
  }
} catch (error) {
  const detail = /before handshake|waiting for handshake/i.test(error.message)
    ? "连接在 SSH 握手完成前中断。请检查当前网络到更新服务器的 SSH 连接。"
    : error.message;
  console.error(`自建更新站${checkOnly ? "预检" : "上传"}失败。${detail}`);
  process.exitCode = 1;
} finally {
  client?.end();
}
