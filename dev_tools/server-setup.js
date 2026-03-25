#!/usr/bin/env node
/**
 * 服务器初始化脚本（只需运行一次）
 * 用途：在阿里云服务器上创建更新文件目录并配置 Apache 静态访问
 *
 * 运行方式：
 *   node dev_tools/server-setup.js
 */

import readline from "readline";
import { Client } from "ssh2";

const HOST = "8.163.0.99";
const USER = "root";
const REMOTE_DIR = "/var/www/html/biu/updates";
const CONF_PATH = "/etc/apache2/sites-available/biu-ip.conf";
const VERIFY_URL = "http://8.163.0.99/biu/updates/";

// Apache VirtualHost 配置：为 IP 直接访问提供静态文件服务
const APACHE_CONF = `<VirtualHost *:80>
    ServerName ${HOST}

    Alias /biu/updates/ ${REMOTE_DIR}/
    <Directory ${REMOTE_DIR}/>
        Options -Indexes
        AllowOverride None
        Require all granted
    </Directory>
</VirtualHost>
`;

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(msg);
}

/** 提示输入密码（不回显）*/
function askPassword() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = str => {
      if (str.endsWith("\n") || str.endsWith("\r")) rl.output.write("\n");
    };
    process.stdout.write("请输入服务器密码：");
    rl.question("", answer => {
      rl.close();
      resolve(answer);
    });
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

/** 通过 SFTP 写入远端文件 */
function writeFile(client, content, remotePath) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      const stream = sftp.createWriteStream(remotePath);
      stream.on("error", reject);
      stream.on("close", resolve);
      stream.end(content);
    });
  });
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

log("╔══════════════════════════════════════════╗");
log("║      Biu 更新服务器初始化（一次性）       ║");
log("╚══════════════════════════════════════════╝");
log(`\n服务器：${USER}@${HOST}`);
log(`目标目录：${REMOTE_DIR}`);
log("");

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
  log("\n▶ 创建更新目录");
  await exec(client, `mkdir -p ${REMOTE_DIR} && chmod 755 ${REMOTE_DIR} && echo "目录已就绪：${REMOTE_DIR}"`);

  log("\n▶ 写入 Apache 配置");
  await writeFile(client, APACHE_CONF, CONF_PATH);
  log("  配置文件已写入：" + CONF_PATH);

  log("\n▶ 启用 Apache 站点配置");
  await exec(client, `a2ensite biu-ip 2>/dev/null && echo '配置已启用' || echo '跳过（非 Debian 系）'`);

  log("\n▶ 验证 Apache 配置语法");
  await exec(client, "apachectl configtest 2>&1 && echo 'Syntax OK'");

  log("\n▶ 重载 Apache");
  await exec(
    client,
    "systemctl reload apache2 2>/dev/null || systemctl reload httpd 2>/dev/null || true && echo 'Apache 已重载'",
  );

  log("\n╔══════════════════════════════════════╗");
  log("║           ✅ 初始化完成！              ║");
  log("╚══════════════════════════════════════╝");
  log(`\n验证地址：${VERIFY_URL}`);
  log("（浏览器访问该地址，显示 Forbidden / You don't have permission 均表示正常）\n");
  log("下一步：运行 pnpm build 打包，然后执行 node dev_tools/upload-update.js 上传。");
} catch (e) {
  log("\n❌ 初始化失败：" + e.message);
  process.exit(1);
} finally {
  client.end();
}
