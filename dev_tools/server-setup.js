#!/usr/bin/env node

/**
 *
 * 更新发布服务的创建或权限变更必须由受控管理员终端执行：
 * - 使用专用、无 shell 的 SFTP 发布账户；
 * - 使用 SSH key/agent，不允许密码认证；
 * - 在既有 HTTPS vhost 中显式配置静态更新路径；
 * - 将真实参数保存在仓库外的私有运维配置中。
 */

console.error("请按 docs/web/Web 生产部署与维护指南.md 的私有运维流程执行服务器初始化。");
process.exitCode = 2;
