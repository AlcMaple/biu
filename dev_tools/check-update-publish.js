#!/usr/bin/env node
/** Local-only desktop release preflight. Never connects to or modifies a server. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ssh2 from "ssh2";

import { getDesktopReleaseArtifacts } from "./update-artifacts.js";
import { loadUpdatePublishConfig, resolveSshAuth } from "./update-deploy-config.js";
import { loadUpdateEnvironment } from "./update-env.js";
import { loadUpdateSigningPrivateKey } from "./update-signature.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
try {
  loadUpdateEnvironment();
  if (
    args.some(arg => !["--config-only", "--win", "--mac"].includes(arg)) ||
    (args.includes("--win") && args.includes("--mac"))
  ) {
    throw new Error("请选择 --win 或 --mac，可加 --config-only；一次检查一个平台");
  }
  const mac = args.includes("--mac") || (!args.includes("--win") && process.platform === "darwin");
  const missing = ["BIU_UPDATE_PUBLISH_HOST", "BIU_UPDATE_PUBLIC_ORIGIN"].filter(name => !process.env[name]?.trim());
  if (!process.env.BIU_UPDATE_PUBLISH_KEY?.trim() && !process.env.SSH_AUTH_SOCK?.trim()) {
    missing.push("BIU_UPDATE_PUBLISH_KEY（或 SSH_AUTH_SOCK）");
  }
  if (missing.length)
    throw new Error(
      `缺少配置：${missing.join("、")}。请填写用户目录 .config/biu/production.env，配置说明见 docs/release/服务器首次配置.md。`,
    );
  loadUpdatePublishConfig();
  const auth = resolveSshAuth();
  if (auth.privateKey && ssh2.utils.parseKey(auth.privateKey) instanceof Error) {
    throw new Error("SSH 私钥无法直接读取；如使用带密码短语的私钥，请先加入 SSH agent，并改用 SSH_AUTH_SOCK。");
  }
  if (!mac) loadUpdateSigningPrivateKey();
  console.log(mac ? "macOS 本机发布配置已通过检查。" : "本机发布配置已通过检查，更新签名密钥与客户端公钥匹配。");
  if (!args.includes("--config-only")) {
    const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const metadataName = mac ? "latest-mac.yml" : "latest.yml";
    getDesktopReleaseArtifacts(path.join(root, "dist", "artifacts"), version, mac ? "mac" : "win");
    console.log(`${mac ? "macOS" : "Windows"} ${version} 双架构发布产物与 ${metadataName} 已齐备。`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "发布预检失败");
  process.exitCode = 1;
}
