#!/usr/bin/env node
/**
 * 将已构建的更新包发布到受限 SFTP 账户
 *
 * 生产目标、账户和认证方式只能来自仓库外的私有环境配置：
 * BIU_UPDATE_PUBLISH_HOST / BIU_UPDATE_PUBLISH_USER / BIU_UPDATE_REMOTE_DIR /
 * BIU_UPDATE_PUBLIC_ORIGIN，以及 BIU_UPDATE_PUBLISH_KEY 或 SSH_AUTH_SOCK
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "ssh2";

import { createWindowsUpdateMetadata, getWindowsUpdateManifestFilename } from "../shared/update-signing.js";
import { loadUpdatePublishConfig, remoteFile, resolveSshAuth } from "./update-deploy-config.js";
import { loadUpdateSigningPrivateKey, signUpdateMetadata } from "./update-signature.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const ARTIFACTS_DIR = path.join(ROOT_DIR, "dist", "artifacts");
const RELEASE_NOTES_FILE = path.join(__dirname, "release-notes.md");

const releaseNotes = fs.existsSync(RELEASE_NOTES_FILE) ? fs.readFileSync(RELEASE_NOTES_FILE, "utf8").trim() : "";
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
const version = pkg.version;

const args = process.argv.slice(2);
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

function putFile(sftp, localPath, remotePath) {
  const total = fs.statSync(localPath).size;
  return new Promise((resolve, reject) => {
    sftp.fastPut(
      localPath,
      remotePath,
      {
        chunkSize: 1024 * 512,
        concurrency: 4,
        step: transferred => {
          const percent = Math.round((transferred / total) * 100);
          process.stdout.write(`\r  ${percent}%  (${(transferred / 1024 / 1024).toFixed(1)} MB)`);
        },
      },
      error => {
        if (error) return reject(error);
        process.stdout.write(`\r  100%  (${(total / 1024 / 1024).toFixed(1)} MB)         \n`);
        resolve();
      },
    );
  });
}

function rename(sftp, source, target) {
  return new Promise((resolve, reject) => sftp.rename(source, target, error => (error ? reject(error) : resolve())));
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

function calculateSha512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    const stream = fs.createReadStream(filePath);
    stream.once("error", reject);
    stream.on("data", chunk => hash.update(chunk));
    stream.once("end", () => resolve(hash.digest("base64")));
  });
}

async function createSignedWindowsManifests(files) {
  const privateKey = loadUpdateSigningPrivateKey();
  const releaseDate = new Date().toISOString();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "biu-signed-update-"));
  const manifests = [];

  try {
    for (const arch of ["x64", "arm64"]) {
      const filename = `Biu-${version}-win-setup-${arch}.exe`;
      const installer = files.find(file => file.platform === "win" && file.filename === filename);
      if (!installer) continue;

      const metadata = createWindowsUpdateMetadata({
        arch,
        filename,
        releaseDate,
        releaseNotes,
        sha512: await calculateSha512(installer.fullPath),
        size: fs.statSync(installer.fullPath).size,
        version,
      });
      const manifestName = getWindowsUpdateManifestFilename(arch);
      const manifestPath = path.join(directory, manifestName);
      fs.writeFileSync(manifestPath, signUpdateMetadata(metadata, privateKey), "utf8");
      manifests.push({ filename: manifestName, fullPath: manifestPath });
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

async function atomicPublish(sftp, localPath, filename, remoteDir) {
  const temporaryName = `${filename}.${process.pid}.tmp`;
  await putFile(sftp, localPath, remoteFile(remoteDir, temporaryName));
  await rename(sftp, remoteFile(remoteDir, temporaryName), remoteFile(remoteDir, filename));
}

if (!fs.existsSync(ARTIFACTS_DIR)) {
  throw new Error("未找到 dist/artifacts/；请先完成构建");
}

const filesToUpload = [];
for (const [platform, enabled] of Object.entries(platforms)) {
  if (!enabled) continue;
  for (const filename of fileGroups[platform]) {
    const fullPath = path.join(ARTIFACTS_DIR, filename);
    if (fs.existsSync(fullPath)) filesToUpload.push({ filename, fullPath, platform });
  }
}

if (filesToUpload.length === 0) {
  throw new Error(`dist/artifacts/ 中没有当前版本 ${version} 的可上传文件`);
}

const config = loadUpdatePublishConfig();
const auth = resolveSshAuth();
const binaries = filesToUpload.filter(file => !file.filename.endsWith(".yml"));
const metadata = filesToUpload.filter(file => file.filename.endsWith(".yml"));
const signedWindowsManifests = platforms.win ? await createSignedWindowsManifests(filesToUpload) : null;

log(`Biu v${version} 更新发布`);
log(
  `待上传文件：${[...filesToUpload.map(file => file.filename), ...(signedWindowsManifests?.manifests ?? []).map(file => file.filename)].join(", ")}`,
);
log("认证：SSH 私钥或 agent（不允许密码认证）");

let client;
try {
  client = await connect(config, auth);
  const sftp = await openSftp(client);

  // 先上传二进制与 blockmap，最后原子替换 metadata。这样客户端不会收到指向不存在文件的版本清单。
  for (const file of binaries) {
    log(`上传 ${file.filename}`);
    await putFile(sftp, file.fullPath, remoteFile(config.remoteDir, file.filename));
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

  log("发布完成。验证地址：");
  for (const file of metadata) log(`  ${publicFileUrl(config.publicOrigin, file.filename)}`);
  for (const manifest of signedWindowsManifests?.manifests ?? []) {
    log(`  ${publicFileUrl(config.publicOrigin, manifest.filename)}`);
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(`更新发布失败：${detail}`);
} finally {
  client?.end();
  signedWindowsManifests?.cleanup();
}
