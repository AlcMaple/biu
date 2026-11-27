import { promisify } from "node:util";
import semver from "semver";

import {
  getWindowsUpdateManifestFilename,
  UPDATE_ENVELOPE_MAX_BYTES,
  verifySignedUpdateEnvelope,
} from "../shared/update-signing.js";
import { readUpdateYamlVersion } from "./update-artifacts.js";
import { remoteFile } from "./update-deploy-config.js";

const publishLockName = "biu-desktop-publish.lock";
const manifestFiles = {
  win: [
    { filename: "latest.yml" },
    ...["x64", "arm64"].map(arch => ({ arch, filename: getWindowsUpdateManifestFilename(arch) })),
  ],
  mac: [{ filename: "latest-mac.yml" }],
  linux: [{ filename: "latest-linux.yml" }],
};

function sftpCall(sftp, method, ...args) {
  return promisify(sftp[method].bind(sftp))(...args);
}

function transferRate(bytesPerSecond) {
  return bytesPerSecond < 1024 ** 2
    ? `${(bytesPerSecond / 1024).toFixed(1)} KiB/s`
    : `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MiB/s`;
}

export async function putFile(sftp, localPath, remotePath, showProgress = false) {
  const started = performance.now();
  const tty = process.stdout.isTTY;
  let lastUpdate = started;
  let previousWidth = 0;
  let uploaded = 0;
  const mib = bytes => (bytes / 1024 ** 2).toFixed(1);
  const step = (transferred, _chunk, total) => {
    uploaded = transferred;
    const now = performance.now();
    if (transferred === total || now - lastUpdate < (tty ? 1000 : 10000)) return;
    lastUpdate = now;
    const speed = transferred / ((now - started) / 1000);
    const remaining = Math.ceil((total - transferred) / speed);
    const eta = remaining < 60 ? `${remaining} 秒` : `${Math.floor(remaining / 60)} 分 ${remaining % 60} 秒`;
    const line = `  ${Math.floor((transferred / total) * 100)}%  ${mib(transferred)} / ${mib(total)} MiB  均速 ${transferRate(speed)}  预计剩余 ${eta}`;
    process.stdout.write(tty ? `\r${line.padEnd(previousWidth)}` : `${line}\n`);
    previousWidth = line.length;
  };

  // ssh2 会把超出服务端单次写入上限的大块拆开并逐段等待确认。沿用 fastPut 的 64 路 32 KiB 小块流水线。
  try {
    await sftpCall(sftp, "fastPut", localPath, remotePath, showProgress ? { step } : {});
  } finally {
    if (tty && previousWidth) process.stdout.write("\n");
  }
  if (showProgress) {
    const seconds = Math.max((performance.now() - started) / 1000, 0.001);
    console.log(`  已传 ${mib(uploaded)} MiB，用时 ${seconds.toFixed(1)} 秒，均速 ${transferRate(uploaded / seconds)}`);
  }
}

export async function checkRemotePublishDirectory(sftp, directory) {
  const stat = await sftpCall(sftp, "stat", directory);
  if (!stat.isDirectory()) throw new Error("SFTP 发布路径必须是目录。");
}

export async function withRemotePublishLock(sftp, directory, publish) {
  const lock = remoteFile(directory, publishLockName);
  try {
    await sftpCall(sftp, "mkdir", lock);
  } catch (error) {
    throw new Error(`无法锁定更新目录。请检查是否有其他电脑正在发布，以及 ${publishLockName} 的状态。`, {
      cause: error,
    });
  }
  try {
    return await publish();
  } finally {
    try {
      await sftpCall(sftp, "rmdir", lock);
    } catch (error) {
      console.error(`无法移除 ${publishLockName}：${error.message}。请核对线上版本及发布任务状态。`);
    }
  }
}

async function readRemoteUpdateFile(sftp, file) {
  let handle;
  try {
    handle = await sftpCall(sftp, "open", file, "r");
  } catch (error) {
    if (error.code === 2) return null;
    throw error;
  }

  try {
    const buffer = Buffer.alloc(UPDATE_ENVELOPE_MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const bytes = await sftpCall(sftp, "read", handle, buffer, size, buffer.length - size, size);
      if (bytes === 0) return buffer.toString("utf8", 0, size);
      size += bytes;
    }
    throw new Error("服务器更新清单响应过大。");
  } finally {
    // SFTP 要单独确认关闭句柄，否则预检退出时会打断仍在等待确认的关闭请求。
    await sftpCall(sftp, "close", handle);
  }
}

export async function checkRemoteUpdateVersion(sftp, directory, platforms, version) {
  if (!semver.valid(version)) throw new Error("package.json 的版本号格式不正确。");
  for (const platform of platforms) {
    for (const { arch, filename } of manifestFiles[platform]) {
      const raw = await readRemoteUpdateFile(sftp, remoteFile(directory, filename));
      if (raw === null) continue;
      const metadata = arch ? verifySignedUpdateEnvelope(raw) : { version: readUpdateYamlVersion(raw) };
      if (!semver.valid(metadata.version) || (arch && metadata.arch !== arch)) {
        throw new Error(`服务器上的 ${filename} 版本或架构不合法。`);
      }
      if (!semver.gt(version, metadata.version)) {
        throw new Error(`服务器上的 ${filename} 已使用 ${metadata.version}，请提高 package.json 的版本号。`);
      }
    }
  }
}

// OpenSSH POSIX rename atomically replaces an existing destination; SFTP v3 rename does not.
export function replaceRemoteFile(sftp, source, target) {
  return new Promise((resolve, reject) => {
    const fail = error =>
      reject(
        new Error("SFTP 原子替换失败：需要服务器支持 posix-rename@openssh.com；未删除原有更新清单", { cause: error }),
      );
    try {
      sftp.ext_openssh_rename(source, target, error => (error ? fail(error) : resolve()));
    } catch (error) {
      fail(error);
    }
  });
}
