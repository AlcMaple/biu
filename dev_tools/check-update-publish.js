#!/usr/bin/env node
/** Local-only desktop release preflight. Never connects to or modifies a server. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ssh2 from "ssh2";

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
  const missing = [
    "BIU_UPDATE_PUBLISH_HOST",
    "BIU_UPDATE_PUBLISH_USER",
    "BIU_UPDATE_REMOTE_DIR",
    "BIU_UPDATE_PUBLIC_ORIGIN",
  ].filter(name => !process.env[name]?.trim());
  if (!process.env.BIU_UPDATE_PUBLISH_KEY?.trim() && !process.env.SSH_AUTH_SOCK?.trim()) {
    missing.push("BIU_UPDATE_PUBLISH_KEY（或 SSH_AUTH_SOCK）");
  }
  if (missing.length)
    throw new Error(
      `缺少配置：${missing.join("、")}。请填写用户目录 .config/biu/production.env；工具会自动读取，配置说明见 docs/release/README.md。`,
    );
  loadUpdatePublishConfig();
  const auth = resolveSshAuth();
  if (auth.privateKey && ssh2.utils.parseKey(auth.privateKey) instanceof Error) {
    throw new Error("SSH 私钥无法直接读取；如使用带密码短语的私钥，请先加入 SSH agent，并改用 SSH_AUTH_SOCK。");
  }
  if (!mac) loadUpdateSigningPrivateKey();
  console.log(
    mac
      ? "macOS 发布配置与 SSH 认证文件检查通过（无需 Windows 更新签名私钥）。"
      : "配置格式和更新签名私钥检查通过（与应用内置公钥匹配）。",
  );
  if (!args.includes("--config-only")) {
    const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const metadataName = mac ? "latest-mac.yml" : "latest.yml";
    const required = ["x64", "arm64"].flatMap(arch =>
      mac
        ? [`Biu-${version}-mac-${arch}.dmg`, `Biu-${version}-mac-${arch}.zip`]
        : [`Biu-${version}-win-setup-${arch}.exe`, `Biu-${version}-win-setup-${arch}.exe.blockmap`],
    );
    required.push(metadataName);
    const directory = path.join(root, "dist", "artifacts");
    const absent = required.filter(name => {
      const file = path.join(directory, name);
      return !fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0;
    });
    if (absent.length)
      throw new Error(`缺少当前版本产物：${absent.join("、")}。请先在对应系统执行 pnpm build 并确认成功。`);
    const yaml = fs.readFileSync(path.join(directory, metadataName), "utf8");
    const metadataVersion = yaml
      .match(/^version:\s*([^\r\n]+)/m)?.[1]
      .trim()
      .replace(/^["']|["']$/g, "");
    if (metadataVersion !== version) throw new Error(`${metadataName} 版本与 package.json 不一致，请重新构建。`);
    console.log(`${mac ? "macOS" : "Windows"} ${version} 双架构发布产物与 ${metadataName} 已齐备。`);
  }
  console.log("仅完成本机预检，未连接服务器、未上传；服务器登录权限和真实客户端升级仍需验证。");
} catch (error) {
  console.error(error instanceof Error ? error.message : "发布预检失败");
  process.exitCode = 1;
}
