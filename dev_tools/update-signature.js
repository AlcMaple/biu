import { createPrivateKey, createPublicKey, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { UPDATE_SIGNING_PUBLIC_KEY_BASE64 } from "../shared/update-signing-public-key.js";
import { createSignedUpdateEnvelope } from "../shared/update-signing.js";

export function getDefaultUpdateSigningKeyPath(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, ".config", "biu", "update-signing-ed25519.pem");
}

export function getUpdateSigningKeyPath(environment = process.env) {
  return environment.BIU_UPDATE_SIGNING_KEY?.trim() || getDefaultUpdateSigningKeyPath();
}

function assertPrivateKeyPermissions(stat) {
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error("更新签名私钥权限过宽；请设置为仅当前用户可读");
  }
}

export function loadUpdateSigningPrivateKey({ environment = process.env, fileSystem = fs } = {}) {
  const keyPath = getUpdateSigningKeyPath(environment);
  if (!fileSystem.existsSync(keyPath)) throw new Error("未找到更新签名私钥；请先在私有环境生成并备份密钥");

  const stat = fileSystem.statSync(keyPath);
  assertPrivateKeyPermissions(stat);
  const privateKey = createPrivateKey(fileSystem.readFileSync(keyPath));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("更新签名私钥必须是 Ed25519");

  const actualPublicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const expectedPublicKey = Buffer.from(UPDATE_SIGNING_PUBLIC_KEY_BASE64, "base64");
  if (
    expectedPublicKey.length === 0 ||
    actualPublicKey.length !== expectedPublicKey.length ||
    !timingSafeEqual(actualPublicKey, expectedPublicKey)
  ) {
    throw new Error("更新签名私钥与应用内置公钥不匹配；停止发布");
  }
  return privateKey;
}

export function signUpdateMetadata(metadata, privateKey) {
  return createSignedUpdateEnvelope(metadata, privateKey);
}
