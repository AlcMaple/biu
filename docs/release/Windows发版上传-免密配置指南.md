# Windows 更新包发布（公开安全版）

> 发布者需要来自管理员的受限 SFTP 账户和私有运维配置

## 发布者需要具备的条件

- 已被管理员授予一个**仅可上传更新文件**的 SFTP key；该 key 不具备 shell、sudo 或其他站点访问权。
- key 使用密码短语并通过 Windows OpenSSH agent 管理，或由企业凭据系统按需提供；不要把 key、密码短语或私有配置保存进仓库。
- 私有配置已在当前 PowerShell 会话加载，至少包含更新源、发布主机、发布账户和远端目录。
- Windows 个人版不依赖付费代码签名证书：自动更新由应用内置 Ed25519 公钥验证；首次安装仍可能出现 Windows 未知发布者提示。

## 每次发布

```powershell
Set-Location D:\path\to\biu
git status --short
pnpm install --frozen-lockfile
pnpm build
node dev_tools/upload-update.js --win
node dev_tools/verify-update-manifest.js --x64
```

工具会拒绝密码认证和旧的 `--install-key` 流程。它只通过 SFTP 发布，先上传二进制，再原子更新 metadata，避免客户端读到半完成版本。

## 验收

在私有配置提供的 HTTPS 更新源上读取 `latest.json`，核对：

- 版本号严格递增；
- 安装包文件名存在；
- SHA-512 与构建产物一致；
- Ed25519 更新清单验证成功，且清单里的 SHA-512 对应本次 Windows NSIS 安装包；
- 真实客户端能发现更新，但不会下载清单或安装包被篡改的版本。

若任一项失败，停止发布并保留产物/日志供管理员回滚；不要通过 root 密码、IP 直连或临时关闭 TLS 来“快速解决”。
