/**
 * 把当前项目压缩成 zip，传到 Windows 解压后跑 `pnpm install` 再 `pnpm dev` / `pnpm build`。
 *
 * macOS 的 node_modules 含原生 binding（如 better-sqlite3、Electron 二进制等），
 * Windows 直接用会崩，所以打包时排除依赖与构建产物，让 Windows 自己装。
 *
 * 同样排除 android/ —— Capacitor Android 工程目前 Windows 端不参与构建。
 *
 * 用法：node scripts/pack.mjs
 */

import { execSync } from "child_process";
import { existsSync, statSync, unlinkSync } from "fs";
import { basename, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const PROJECT = basename(ROOT);

// 本地时间，不是 UTC —— 文件名里的时分要和用户看到的钟一致
const now = new Date();
const pad = n => String(n).padStart(2, "0");
const DATE = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const TIME = `${pad(now.getHours())}${pad(now.getMinutes())}`;
const OUTPUT = resolve(ROOT, `${PROJECT}-${DATE}-${TIME}.zip`);

// 一律排除：依赖、版本控制、构建产物、平台元数据、Capacitor Android 工程
const EXCLUDE_DIRS = [
  "node_modules",
  ".git",
  ".electron", // Electron 主进程构建缓存（dev/build 时会重生成）
  ".gitnexus",
  ".cache",
  ".turbo",
  ".next",
  ".nuxt",
  "dist",
  "out",
  "build",
  "logs",
  "archive",
  "android", // Capacitor Android 工程，Windows 仅运行 Electron
];

const EXCLUDES = [
  ...EXCLUDE_DIRS.map(p => `--exclude="${PROJECT}/${p}/*"`),
  `--exclude="*.DS_Store"`, // macOS 元数据
];

if (existsSync(OUTPUT)) unlinkSync(OUTPUT); // 同一分钟内重复打包才会触发

const cmd = `cd "${resolve(ROOT, "..")}" && zip -r "${OUTPUT}" "${PROJECT}" ${EXCLUDES.join(" ")}`;

console.log(`Packing → ${OUTPUT}`);
execSync(cmd, { stdio: "inherit" });

const size = (statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
console.log(`Done. ${size} MB → ${OUTPUT}`);
