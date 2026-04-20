#!/usr/bin/env node
/**
 * Biu 依赖一键安装（跨平台，推荐在 Windows 上使用）
 *
 * 用法：在项目根目录执行
 *   node dev_tools/setup-win.js
 *
 * 作用：配置 Git/pnpm 镜像 -> 清理 node_modules -> 安装依赖
 *       -> 自动校验 Electron 二进制与 @rsbuild/core 是否就位
 * 幂等：可以反复运行，不会破坏 pnpm-lock.yaml
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const IS_WINDOWS = process.platform === "win32";
const ROOT = process.cwd();

const ELECTRON_BIN = IS_WINDOWS
  ? path.join(ROOT, "node_modules", "electron", "dist", "electron.exe")
  : process.platform === "darwin"
    ? path.join(ROOT, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
    : path.join(ROOT, "node_modules", "electron", "dist", "electron");

function log(msg) {
  console.log(msg);
}

function section(title) {
  console.log("");
  console.log(title);
}

function die(msg, code = 1) {
  console.error(`[X] ${msg}`);
  process.exit(code);
}

/** 同步执行命令，stdio 直通当前终端。返回 exit code。 */
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: IS_WINDOWS,
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd || ROOT,
  });
  if (result.error) return -1;
  return result.status ?? -1;
}

/** 执行命令并捕获 stdout。 */
function capture(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", shell: IS_WINDOWS });
  return { code: result.status ?? -1, stdout: (result.stdout || "").trim() };
}

function has(cmd) {
  const probe = IS_WINDOWS ? "where" : "which";
  return capture(probe, [cmd]).code === 0;
}

log("============================================");
log("  Biu 依赖一键安装");
log("============================================");

// ---- [1/6] 前置工具 ----
section("[1/6] 检查 Node / Git / pnpm...");
if (!has("node")) die("未找到 node，请先安装 Node.js 22.17.1");
if (!has("git")) die("未找到 git");
if (!has("pnpm")) {
  log("    未检测到 pnpm，通过 corepack 启用...");
  if (run("corepack", ["enable"]) !== 0) die("corepack enable 失败，请手动 npm i -g pnpm");
}
log(`    node: ${capture("node", ["-v"]).stdout}`);
log(`    pnpm: ${capture("pnpm", ["-v"]).stdout}`);

// ---- [2/6] Git 协议改写 ----
section("[2/6] 配置 Git 使用 HTTPS 代替 SSH/git 协议...");
run("git", ["config", "--global", "url.https://github.com/.insteadOf", "git@github.com:"]);
run("git", ["config", "--global", "url.https://.insteadOf", "git://"]);
log("    OK");

// ---- [3/6] pnpm 全局镜像 ----
section("[3/6] 配置 pnpm 镜像...");
run("pnpm", ["config", "set", "registry", "https://registry.npmmirror.com"]);
run("pnpm", ["config", "set", "fetch-timeout", "100000"]);
run("pnpm", ["config", "set", "fetch-retries", "5"]);
log("    OK");

// ---- [4/6] Electron 镜像环境变量 ----
section("[4/6] 设置 Electron 二进制镜像（仅本次会话）...");
const electronEnv = {
  ELECTRON_MIRROR: "https://registry.npmmirror.com/-/binary/electron/",
  ELECTRON_BUILDER_BINARIES_MIRROR: "https://registry.npmmirror.com/-/binary/electron-builder-binaries/",
};
log("    OK");

// ---- [5/6] 清理 node_modules ----
section("[5/6] 清理 node_modules（保留 pnpm-lock.yaml）...");
const nm = path.join(ROOT, "node_modules");
if (fs.existsSync(nm)) fs.rmSync(nm, { recursive: true, force: true });
log("    OK");

// ---- [6/6] 安装依赖 ----
section("[6/6] 安装依赖（耗时较长，不要关窗口）...");
let installed = run("pnpm", ["install"], { env: electronEnv }) === 0;
if (!installed) {
  log("");
  log("[!] 标准安装失败，回退到 --ignore-scripts 模式...");
  if (run("pnpm", ["install", "--ignore-scripts"], { env: electronEnv }) !== 0) {
    die("依赖安装彻底失败，请将日志发给 Claude 排查");
  }
  log("[!] 手动补装 Electron 二进制...");
  if (run("node", [path.join("node_modules", "electron", "install.js")], { env: electronEnv }) !== 0) {
    die("Electron 二进制下载失败");
  }
  installed = true;
}

// ---- 校验 ----
section("[校验] 检查关键文件...");
if (!fs.existsSync(ELECTRON_BIN)) {
  log("[!] Electron 二进制缺失，补装一次...");
  run("node", [path.join("node_modules", "electron", "install.js")], { env: electronEnv });
}
if (fs.existsSync(ELECTRON_BIN)) {
  log("[OK] Electron 二进制就绪");
} else {
  die("Electron 二进制始终缺失，pnpm dev 会失败");
}

if (!fs.existsSync(path.join(ROOT, "node_modules", "@rsbuild", "core"))) {
  die("@rsbuild/core 未安装，pnpm dev 会失败");
}
log("[OK] @rsbuild/core 就绪");

log("");
log("============================================");
log("  [OK] 安装完成！下一步：");
log("    pnpm dev       启动开发");
log("    pnpm build     打包发布");
log("============================================");
