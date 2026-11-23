import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateGitHubRepository } from "../shared/github-release.js";
import { getUpdateSigningTrust, verifySignedUpdateEnvelope } from "../shared/update-signing.js";

export function verifyPreviousRelease(previousRelease, trust) {
  try {
    const metadata = verifySignedUpdateEnvelope(previousRelease.manifest, trust);
    if (metadata.version !== previousRelease.version || metadata.arch !== "x64") {
      throw new Error("上一版清单的版本或架构与发行记录不符");
    }
  } catch (error) {
    throw new Error(`本机密钥无法验证上一版 Windows 更新。请核对发行记录和原私钥备份：${error.message}`);
  }
}

export function prepareGitHubReleaseKey({
  repository,
  previousRelease,
  registeredKey = null,
  checkOnly,
  homeDirectory = os.homedir(),
}) {
  const name = validateGitHubRepository(repository).toLowerCase();
  const keyPath = path.join(homeDirectory, ".config", "biu", "github", name, "update-signing-ed25519.pem");

  if (!fs.existsSync(keyPath)) {
    if (previousRelease || registeredKey)
      throw new Error(`此仓库已使用 Windows 更新密钥。请把原签名私钥从备份恢复到 ${keyPath}`);
    if (checkOnly) return null;

    fs.mkdirSync(path.dirname(keyPath), { mode: 0o700, recursive: true });
    const { privateKey } = generateKeyPairSync("ed25519");
    fs.writeFileSync(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }), { flag: "wx", mode: 0o600 });
    console.log(`已生成 Windows 更新签名私钥，请将此文件加密备份：${keyPath}`);
  }

  const privateKey = createPrivateKey(fs.readFileSync(keyPath));
  const publicKeyBase64 = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64");
  const trust = getUpdateSigningTrust(publicKeyBase64);
  if (registeredKey && publicKeyBase64 !== registeredKey) {
    throw new Error(`本机私钥与仓库登记的公钥不符。请从备份恢复原签名私钥：${keyPath}`);
  }
  if (previousRelease) verifyPreviousRelease(previousRelease, trust);
  return { privateKey, ...trust };
}
