#!/usr/bin/env node
/**
 * 更新文件上传脚本（每次发版后运行）
 * 用途：将打包产物上传到阿里云服务器的更新目录
 *
 * 前提：已运行过 pnpm build，产物在 dist/artifacts/ 目录下
 *
 * 运行方式：
 *   node dev_tools/upload-update.js
 *
 * 可选参数：
 *   --win     只上传 Windows 相关文件
 *   --mac     只上传 macOS 相关文件
 *   --linux   只上传 Linux 相关文件
 *   （不传参数则上传所有平台）
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVER = "root@8.163.0.99";
const REMOTE_DIR = "/var/www/html/biu/updates/";
const ROOT_DIR = path.join(__dirname, "..");
const ARTIFACTS_DIR = path.join(ROOT_DIR, "dist", "artifacts");

// ─── 读取版本号 ───────────────────────────────────────────────────────────────

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
const version = pkg.version;

// ─── 解析参数，决定上传哪些平台 ──────────────────────────────────────────────

const args = process.argv.slice(2);
const uploadWin = args.length === 0 || args.includes("--win");
const uploadMac = args.length === 0 || args.includes("--mac");
const uploadLinux = args.length === 0 || args.includes("--linux");

// ─── 待上传文件列表（按平台分组）─────────────────────────────────────────────

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

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function scp(localFile) {
  // Windows 下路径分隔符转为正斜杠，避免 scp 解析错误
  const localPath = localFile.replace(/\\/g, "/");
  execSync(`scp -o StrictHostKeyChecking=no "${localPath}" ${SERVER}:${REMOTE_DIR}`, {
    stdio: "inherit",
  });
}

function log(msg) {
  console.log(msg);
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

log("╔══════════════════════════════════════════╗");
log(`║       Biu v${version} 上传更新文件           ║`);
log("╚══════════════════════════════════════════╝");

// 检查 dist/artifacts/ 目录是否存在
if (!fs.existsSync(ARTIFACTS_DIR)) {
  log("\n❌ 未找到 dist/artifacts/ 目录，请先运行 pnpm build 完成打包。");
  process.exit(1);
}

// 收集实际存在的文件
const filesToUpload = [];
const platforms = { win: uploadWin, mac: uploadMac, linux: uploadLinux };

for (const [platform, enabled] of Object.entries(platforms)) {
  if (!enabled) continue;
  for (const filename of fileGroups[platform]) {
    const fullPath = path.join(ARTIFACTS_DIR, filename);
    if (fs.existsSync(fullPath)) {
      filesToUpload.push({ platform, filename, fullPath });
    }
  }
}

if (filesToUpload.length === 0) {
  log("\n❌ dist/artifacts/ 中没有找到任何匹配的文件。");
  log(`   当前版本：${version}，请确认打包是否成功。`);
  process.exit(1);
}

// 显示待上传列表
log(`\n服务器：${SERVER}`);
log(`目标路径：${REMOTE_DIR}`);
log(`\n找到 ${filesToUpload.length} 个文件待上传：`);
for (const { platform, filename } of filesToUpload) {
  const tag = { win: "Win ", mac: "Mac ", linux: "Linux" }[platform];
  log(`  [${tag}] ${filename}`);
}
log("");

// 逐个上传
let successCount = 0;
for (const { filename, fullPath } of filesToUpload) {
  process.stdout.write(`上传 ${filename} ... `);
  try {
    scp(fullPath);
    successCount++;
    log("✅");
  } catch (e) {
    log("❌ 失败");
    log(`\n错误：${e.message}`);
    log("\n排查建议：");
    log("  1. 确认服务器 IP 和密码正确");
    log("  2. 确认已运行过 node dev_tools/server-setup.js 完成服务器初始化");
    log("  3. 确认本机已安装 OpenSSH（Windows 10+ 已内置，macOS 已内置）");
    process.exit(1);
  }
}

log(`\n╔══════════════════════════════════════╗`);
log(`║  ✅ 上传完成（${successCount}/${filesToUpload.length} 个文件）            ║`);
log(`╚══════════════════════════════════════╝`);
log("\n验证地址：");

if (uploadWin) log("  Windows: http://8.163.0.99/biu/updates/latest.yml");
if (uploadMac) log("  macOS:   http://8.163.0.99/biu/updates/latest-mac.yml");
if (uploadLinux) log("  Linux:   http://8.163.0.99/biu/updates/latest-linux.yml");
log("");
