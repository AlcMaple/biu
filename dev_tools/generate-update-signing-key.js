#!/usr/bin/env node
/**
 * 创建免费个人更新通道的 Ed25519 私钥
 * 输出提交的公钥和 keyId
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveKeyPath(environment = process.env) {
  return (
    environment.BIU_UPDATE_SIGNING_KEY?.trim() ||
    path.join(os.homedir(), ".config", "biu", "update-signing-ed25519.pem")
  );
}

const keyPath = resolveKeyPath();
if (fs.existsSync(keyPath)) {
  throw new Error("更新签名私钥已经存在；为避免覆盖，请显式轮换密钥而不是再次生成。");
}

fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
fs.chmodSync(path.dirname(keyPath), 0o700);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
fs.writeFileSync(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }), {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx",
});
fs.chmodSync(keyPath, 0o600);

const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
console.log(
  JSON.stringify(
    {
      keyId: `ed25519-${createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 16)}`,
      publicKeyBase64: publicKeyDer.toString("base64"),
    },
    null,
    2,
  ),
);
