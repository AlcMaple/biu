# 在本机发布桌面版

在 Windows 上发布 Windows 包，在 Mac 上发布 Mac 包。安装包和更新清单上传到配置的自建更新站

## 第一次准备发布电脑

1. 在项目目录执行 `pnpm install --frozen-lockfile`。[环境要求](../../README.md#环境要求)
2. 换电脑时，将原 `production.env`、更新签名私钥和 SFTP 私钥恢复到用户目录的 `.config/biu/`，修改 `production.env` 中的两条私钥绝对路径。更新地址和签名私钥沿用原来的配置。只发布 Mac 时只需 SFTP 认证。[首次搭建更新站](服务器首次配置.md)
3. 执行 `pnpm release:desktop --check`，检查配置、原签名私钥和 SFTP 连接

## 每次发布

把 `package.json` 中的版本号提高到线上版本之上，更新 `dev_tools/release-notes.md`。在项目目录执行：

```sh
pnpm release:desktop
```

这条命令会检查发布条件、构建本机平台的安装包、通过 SFTP 上传，并验证线上更新清单。两台电脑可以使用同一套配置轮流发版

Windows 安装版继续从原地址检查更新。发版后，用上一版安装版检查更新并确认可以安装。Mac 和 Windows 便携版使用手动覆盖安装。[升级和卸载](升级和卸载.md)

本机试安装时，执行 `pnpm build`，在 `dist/artifacts` 取包。[打包与安装](打包与安装.md)
