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
