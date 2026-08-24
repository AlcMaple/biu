import fs from "node:fs";
import path from "node:path";

function requiredEnv(name, environment = process.env) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`缺少私有部署配置 ${name}`);
  return value;
}

function parseHost(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value)) throw new Error(`${name} 格式不合法`);
  return value;
}

function parseUser(value, name) {
  if (!/^[a-z_][a-z0-9_-]*[$]?$/i.test(value)) throw new Error(`${name} 格式不合法`);
  return value;
}

function parseRemoteDirectory(value) {
  if (!value.startsWith("/") || value.includes("\0") || value.includes("..")) {
    throw new Error("BIU_UPDATE_REMOTE_DIR 必须是无 .. 的绝对 POSIX 路径");
  }
  return value.endsWith("/") ? value : `${value}/`;
}

function parsePublicOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("BIU_UPDATE_PUBLIC_ORIGIN 必须是无凭据的 HTTPS origin");
  }
  return url.toString().replace(/\/$/, "");
}

function assertPrivateKeyPermissions(keyPath, stat) {
  if (process.platform === "win32") return;
  if ((stat.mode & 0o077) !== 0) {
    throw new Error("部署私钥权限过宽；请设置为仅当前用户可读");
  }
}

export function resolveSshAuth({
  environment = process.env,
  fileSystem = fs,
  keyVariable = "BIU_UPDATE_PUBLISH_KEY",
} = {}) {
  const keyPath = environment[keyVariable]?.trim();
  if (keyPath) {
    if (!fileSystem.existsSync(keyPath)) throw new Error(`${keyVariable} 指向的私钥文件不存在`);
    const stat = fileSystem.statSync(keyPath);
    assertPrivateKeyPermissions(keyPath, stat);
    return { privateKey: fileSystem.readFileSync(keyPath) };
  }

  const agent = environment.SSH_AUTH_SOCK?.trim();
  if (agent) return { agent };
  throw new Error(`需要 ${keyVariable} 或 SSH_AUTH_SOCK；不允许密码认证`);
}

export function loadUpdatePublishConfig(environment = process.env) {
  return {
    host: parseHost(requiredEnv("BIU_UPDATE_PUBLISH_HOST", environment), "BIU_UPDATE_PUBLISH_HOST"),
    publicOrigin: parsePublicOrigin(requiredEnv("BIU_UPDATE_PUBLIC_ORIGIN", environment)),
    remoteDir: parseRemoteDirectory(requiredEnv("BIU_UPDATE_REMOTE_DIR", environment)),
    user: parseUser(requiredEnv("BIU_UPDATE_PUBLISH_USER", environment), "BIU_UPDATE_PUBLISH_USER"),
  };
}

export function loadUpdateAdminConfig(environment = process.env) {
  return {
    apacheConfigPath: requiredEnv("BIU_UPDATE_APACHE_CONFIG", environment),
    host: parseHost(requiredEnv("BIU_UPDATE_ADMIN_HOST", environment), "BIU_UPDATE_ADMIN_HOST"),
    publicOrigin: parsePublicOrigin(requiredEnv("BIU_UPDATE_PUBLIC_ORIGIN", environment)),
    remoteDir: parseRemoteDirectory(requiredEnv("BIU_UPDATE_REMOTE_DIR", environment)),
    user: parseUser(requiredEnv("BIU_UPDATE_ADMIN_USER", environment), "BIU_UPDATE_ADMIN_USER"),
  };
}

export function remoteFile(remoteDir, filename) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)) throw new Error("发布文件名不合法");
  return path.posix.join(remoteDir, filename);
}
