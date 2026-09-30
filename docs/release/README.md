# 桌面应用发布

Windows 包在 Windows 构建，Mac 包在 Mac 构建

## 1. 生成 SSH 发布密钥（每台发布电脑首次执行）

已有自己的发布密钥就跳过，不要覆盖。提示输入 passphrase 时直接回车；生成后限制私钥文件访问权限并做加密备份

### Windows CMD

```bat
if not exist "%USERPROFILE%\.config\biu\keys" mkdir "%USERPROFILE%\.config\biu\keys"
ssh-keygen -t ed25519 -f "%USERPROFILE%\.config\biu\keys\biu_update_publisher" -C "biu-update-publisher"
type "%USERPROFILE%\.config\biu\keys\biu_update_publisher.pub"
```

### Mac 终端

```bash
mkdir -p "$HOME/.config/biu/keys"
chmod 700 "$HOME/.config/biu" "$HOME/.config/biu/keys"
ssh-keygen -t ed25519 -f "$HOME/.config/biu/keys/biu_update_publisher" -C "biu-update-publisher"
chmod 600 "$HOME/.config/biu/keys/biu_update_publisher"
cat "$HOME/.config/biu/keys/biu_update_publisher.pub"
```

把输出的 **`.pub` 公钥**按[服务器首次配置](服务器首次配置.md)登记到你自己的服务器。两台电脑各自生成密钥时，两行公钥都登记进去

## 2. 填写本机配置（首次执行）

### Windows CMD

```bat
if not exist "%USERPROFILE%\.config\biu\production.env" copy dev_tools\release.env.example "%USERPROFILE%\.config\biu\production.env"
notepad "%USERPROFILE%\.config\biu\production.env"
```

### Mac 终端

```bash
test -f "$HOME/.config/biu/production.env" || cp dev_tools/release.env.example "$HOME/.config/biu/production.env"
nano "$HOME/.config/biu/production.env"
chmod 600 "$HOME/.config/biu/production.env"
```

按[模板里的例子](../../dev_tools/release.env.example)填写：服务器公网 IP、发布用户名、下载域名、自己电脑上的私钥路径。只发布 Mac 时，签名私钥项留空。路径必须完整，不能写 `%USERPROFILE%`、`$HOME` 或 `~`。

保存后，发布工具自动读取当前用户目录的 `.config/biu/production.env`。Windows 和 Mac 都不用手动加载，也不用每次加 `--env-file`。

## 3. 生成 Windows 更新签名密钥（只做一次）

在准备发布 Windows 的电脑上执行：

```bash
node dev_tools/generate-update-signing-key.js
```

将输出填入 `shared/update-signing-public-key.js`：

```js
export const UPDATE_SIGNING_ALGORITHM = "ed25519";
export const UPDATE_SIGNING_KEY_ID = "复制刚输出的 keyId";
export const UPDATE_SIGNING_PUBLIC_KEY_BASE64 = "复制刚输出的 publicKeyBase64";
```

将生成的私钥文件**完整路径**填入本机 `production.env` 的 `BIU_UPDATE_SIGNING_KEY`。默认文件在用户目录 `.config/biu/update-signing-ed25519.pem`；如果之前设置了同名环境变量，会生成到指定路径。

公钥文件提交到自己的 fork；私钥做加密备份，不提交、不上传服务器。已有自己发布过的版本时继续用原签名密钥，换电脑从备份恢复。只发布 Mac 可以跳过这节。

## 4. 把客户端更新地址改成自己的（首次执行）

下面三处地址都改成 `BIU_UPDATE_PUBLIC_ORIGIN` 中填写的 HTTPS 地址，比如 `https://updates.example.com/updates/`：

```text
electron/updater/index.ts          → UPDATE_PUBLIC_ORIGIN
plugins/electron-build.ts         → publish.url
electron/updater/dev-app-update.yml → url
```

只改 `.env` 不会改变已打包客户端的更新地址。新 fork 的首个版本需手动安装，之后才从你自己的服务器更新。

首次配置完成后执行一次；以后只在依赖变化时再执行 `pnpm install`：

```bash
pnpm install --frozen-lockfile
node dev_tools/check-update-publish.js --config-only
```

## 5. Windows 每次发布（CMD）

更新 `package.json` 的版本号及 `dev_tools/release-notes.md`；已经准备好版本号则不重复修改。

```bat
pnpm build
node dev_tools/upload-update.js --win
node dev_tools/verify-update-manifest.js
```

最后用自己上一版客户端检查更新、下载、安装，确认版本

## 6. Mac 每次发布（终端）

使用与 Windows 相同的版本和代码提交。Mac 发布不需要 Windows 更新签名私钥。

```bash
pnpm build
node dev_tools/upload-update.js --mac
```

下载对应架构 DMG，退出 Biu，拖入 Applications 覆盖安装。当前 Mac 版手动升级，不支持 Windows 的签名自动更新

> 同名系统环境变量会覆盖配置文件；改文件不生效时检查旧的 `BIU_UPDATE_*`。Windows 发布不需要 Mac 在线。

卸载不删除云端数据；重装后登录同一账号，可恢复已同步的 Biu 本地歌单、歌曲条目、重命名歌名和自建标签。未同步内容、本机设置和音频文件本身除外。详见[升级和卸载](升级和卸载.md)。
