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

import fs from "fs";
import path from "path";
import readline from "readline";
import { Client } from "ssh2";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 读取更新说明 ─────────────────────────────────────────────────────────────

const RELEASE_NOTES_FILE = path.join(__dirname, "release-notes.md");
const releaseNotes = fs.existsSync(RELEASE_NOTES_FILE) ? fs.readFileSync(RELEASE_NOTES_FILE, "utf8").trim() : "";

const HOST = "8.163.0.99";
const USER = "root";
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

function log(msg) {
  console.log(msg);
}

/** 提示输入密码（不回显）*/
function askPassword() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let muted = false;
    // 先允许输出（显示提示语），输入阶段再屏蔽回显
    rl._writeToOutput = str => {
      if (!muted) {
        rl.output.write(str);
      } else if (str.endsWith("\n") || str.endsWith("\r\n")) {
        rl.output.write("\n");
      }
    };
    rl.question("请输入服务器密码：", answer => {
      muted = false;
      rl.close();
      resolve(answer.replace(/\r/g, ""));
    });
    // question() 写完提示语后才执行这行，之后的字符输入才被屏蔽
    muted = true;
  });
}

/** 建立 SSH 连接 */
function connect(password) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client
      .on("ready", () => resolve(client))
      .on("error", reject)
      .connect({ host: HOST, port: 22, username: USER, password, readyTimeout: 10000 });
  });
}

/** 在远端执行命令，输出打印到终端 */
function exec(client, cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", d => {
        out += d;
        process.stdout.write(d);
      });
      stream.stderr.on("data", d => process.stderr.write(d));
      stream.on("close", code => {
        if (code !== 0) reject(new Error(`命令退出码 ${code}`));
        else resolve(out);
      });
    });
  });
}

/** 通过 SFTP 上传单个文件，显示进度。remoteFilename 可覆盖远端文件名（用于临时文件） */
function upload(client, localPath, remoteDir, remoteFilename) {
  const filename = remoteFilename ?? path.basename(localPath);
  const remotePath = remoteDir + filename;
  const total = fs.statSync(localPath).size;

  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(
        localPath,
        remotePath,
        {
          step: (transferred, _chunk, total) => {
            const pct = Math.round((transferred / total) * 100);
            process.stdout.write(
              `\r  ${pct}%  (${(transferred / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB)`,
            );
          },
          concurrency: 4,
          chunkSize: 1024 * 512,
        },
        err => {
          if (err) return reject(err);
          process.stdout.write(`\r  100%  (${(total / 1024 / 1024).toFixed(1)} MB)         \n`);
          resolve();
        },
      );
    });
  });
}

/** 删除旧版本安装包 */
async function cleanOldVersions(client, platforms) {
  const patterns = [];
  if (platforms.win) patterns.push("Biu-*-win-*.exe", "Biu-*-win-*.exe.blockmap");
  if (platforms.mac) patterns.push("Biu-*-mac-*.dmg", "Biu-*-mac-*.dmg.blockmap");
  if (platforms.linux) patterns.push("Biu-*-linux-*.AppImage");
  if (patterns.length === 0) return;
  const cmd = patterns.map(p => `find ${REMOTE_DIR} -maxdepth 1 -name '${p}' -delete`).join(" && ");
  await exec(client, cmd);
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
log(`\n服务器：${USER}@${HOST}`);
log(`目标路径：${REMOTE_DIR}`);
log(`\n找到 ${filesToUpload.length} 个文件待上传：`);
for (const { platform, filename } of filesToUpload) {
  const tag = { win: "Win ", mac: "Mac ", linux: "Linux" }[platform];
  log(`  [${tag}] ${filename}`);
}
log("");

// 提示输入密码（一次性，后续所有操作复用同一连接）
const password = await askPassword();
log("");

let client;
try {
  process.stdout.write("连接服务器...");
  client = await connect(password);
  log(" ✅");
} catch (e) {
  log("\n❌ 连接失败：" + e.message);
  log("   请确认 IP、用户名和密码是否正确。");
  process.exit(1);
}

try {
  // 清理旧版本安装包
  log("\n▶ 清理服务器旧版本安装包");
  await cleanOldVersions(client, platforms);

  // 逐个上传
  let successCount = 0;
  for (const { filename, fullPath } of filesToUpload) {
    log(`\n▶ 上传 ${filename}`);

    // 对 YAML 元数据文件注入 releaseNotes 后上传临时副本
    const isYml = filename.endsWith(".yml");
    let uploadPath = fullPath;
    let tempYml = null;
    if (isYml && releaseNotes) {
      const original = fs.readFileSync(fullPath, "utf8");
      // 移除旧的 releaseNotes 字段（如有），再追加新内容
      const stripped = original.replace(/^releaseNotes:[\s\S]*?(?=^\w|\Z)/m, "").trimEnd();
      const indented = releaseNotes
        .split("\n")
        .map(l => `  ${l}`)
        .join("\n");
      const patched = `${stripped}\nreleaseNotes: |\n${indented}\n`;
      tempYml = fullPath + ".tmp";
      fs.writeFileSync(tempYml, patched, "utf8");
      uploadPath = tempYml;
    }

    try {
      await upload(client, uploadPath, REMOTE_DIR, filename);
      successCount++;
      log("  ✅ 完成");
    } catch (e) {
      log(`  ❌ 失败：${e.message}`);
      client.end();
      process.exit(1);
    } finally {
      if (tempYml) fs.rmSync(tempYml, { force: true });
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
} finally {
  client.end();
}
