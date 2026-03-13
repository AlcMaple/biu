#!/usr/bin/env node
/**
 * 服务器初始化脚本（只需运行一次）
 * 用途：在阿里云服务器上创建更新文件目录并配置 Apache 静态访问
 *
 * 运行方式：
 *   node dev_tools/server-setup.js
 */

import { execSync } from "child_process";

const SERVER = "root@8.163.0.99";
const REMOTE_DIR = "/var/www/html/biu/updates";
const CONF_PATH = "/etc/apache2/conf-available/biu-updates.conf";
const VERIFY_URL = "http://8.163.0.99/biu/updates/";

// Apache 配置内容：
// - ProxyPassMatch ! 确保此路径不被 ProxyPass 代理拦截（必须放在最前面生效）
// - Directory 块允许访问并禁止目录列表
const APACHE_CONF = `# Biu 自动更新文件目录 - 静态访问配置
# ProxyPassMatch ! 使此路径绕过所有 ProxyPass 代理规则
ProxyPassMatch ^/biu/updates/(.*)$ !

Alias /biu/updates/ /var/www/html/biu/updates/

<Directory /var/www/html/biu/updates/>
    Options -Indexes
    AllowOverride None
    Require all granted
</Directory>
`;

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function ssh(desc, cmd) {
  console.log(`\n▶ ${desc}`);
  execSync(`ssh -o StrictHostKeyChecking=no ${SERVER} "${cmd}"`, { stdio: "inherit" });
}

// 将文件内容通过 base64 安全地写入远程文件，避免 shell 特殊字符转义问题
function sshWriteFile(desc, content, remotePath) {
  console.log(`\n▶ ${desc}`);
  const encoded = Buffer.from(content).toString("base64");
  execSync(`ssh -o StrictHostKeyChecking=no ${SERVER} "echo '${encoded}' | base64 -d > ${remotePath}"`, {
    stdio: "inherit",
  });
}

function log(msg) {
  console.log(msg);
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

log("╔══════════════════════════════════════════╗");
log("║      Biu 更新服务器初始化（一次性）       ║");
log("╚══════════════════════════════════════════╝");
log(`\n服务器：${SERVER}`);
log(`目标目录：${REMOTE_DIR}`);

try {
  // 1. 创建目录并设置权限
  ssh("创建更新目录", `mkdir -p ${REMOTE_DIR} && chmod 755 ${REMOTE_DIR} && echo "目录已就绪：${REMOTE_DIR}"`);

  // 2. 写入 Apache 配置文件（base64 传输，避免特殊字符转义问题）
  sshWriteFile("写入 Apache 配置", APACHE_CONF, CONF_PATH);

  // 3. 启用配置（Ubuntu/Debian 的 a2enconf 工具）
  ssh(
    "启用 Apache 配置",
    `a2enconf biu-updates 2>/dev/null && echo '配置已启用' || echo '跳过 a2enconf（非 Debian 系）'`,
  );

  // 4. 验证 Apache 配置语法
  ssh("验证 Apache 配置语法", "apachectl configtest 2>&1 && echo 'Syntax OK'");

  // 5. 重载 Apache（兼容 Ubuntu/Debian 和 CentOS/AliyunLinux）
  ssh(
    "重载 Apache",
    "systemctl reload apache2 2>/dev/null || systemctl reload httpd 2>/dev/null || true && echo 'Apache 已重载'",
  );

  log("\n╔══════════════════════════════════════╗");
  log("║           ✅ 初始化完成！              ║");
  log("╚══════════════════════════════════════╝");
  log(`\n验证地址：${VERIFY_URL}`);
  log("（浏览器访问该地址，显示 Forbidden / You don't have permission 均表示正常）");
  log("（若显示 Service Unavailable，说明配置未生效，请重新运行本脚本）\n");
  log("下一步：运行 pnpm build 打包，然后执行 node dev_tools/upload-update.js 上传。");
} catch (e) {
  log("\n❌ 初始化失败，错误信息：");
  log(e.message);
  log("\n排查建议：");
  log("  1. 确认服务器 IP 和密码正确");
  log("  2. 确认服务器已安装 Apache（httpd 或 apache2）");
  log("  3. 确认本机已安装 OpenSSH（Windows 10+ 已内置，macOS 已内置）");
  process.exit(1);
}
