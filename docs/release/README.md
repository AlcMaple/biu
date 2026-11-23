# 在本机发布桌面版

在 Windows 上发布 Windows 包，在 Mac 上发布 Mac 包。安装包上传到自己公开仓库的 GitHub Releases

已经能打包并登录 GitHub CLI，可直接看[每次发布](#每次发布)

如果只想在自己的电脑安装，运行 `pnpm build` 后打开 `dist/artifacts` 即可。[本机打包与安装](打包与安装.md)

## 第一次使用

1. **准备自己的仓库。** 在 GitHub 上打开 Biu，点击 **Fork → Create fork**
2. **准备本机工具。** Windows 打开「命令提示符」（CMD），Mac 打开「终端」。用 `git --version` 和 `node --version` 检查 Git 和 Node.js。新装选 Node.js 26 LTS，电脑已有 Node 26 可直接使用。[Git 下载](https://git-scm.com/downloads) · [Node.js 下载](https://nodejs.org/en/download) · [其他兼容版本](../../README.md#环境要求)

   用 `gh --version` 检查 GitHub CLI。若找不到 `gh`，Windows 运行 `winget install --id GitHub.cli -e`，使用 Homebrew 的 Mac 运行 `brew install gh`。安装后重新打开 CMD 或终端。[GitHub CLI 下载](https://cli.github.com/)

3. **登录 GitHub。** 每台发布电脑执行一次，按提示在浏览器里用自己的账号授权。

   ```sh
   gh auth login --hostname github.com --git-protocol https --web
   ```

4. **进入自己的项目目录。** 已有本地仓库时，打开能看到 `package.json` 的文件夹。Windows 在文件资源管理器地址栏输入 `cmd` 并回车。Mac 在终端输入 `cd` 和一个空格，把该文件夹拖进去，再按回车。

   首次克隆时，在自己 fork 的 GitHub 页面复制地址。把第一条命令里的 `你的仓库地址` 换成刚复制的地址，再用第二条命令进入新目录。

   ```sh
   gh repo clone 你的仓库地址 biu
   cd biu
   ```

   运行 `git remote get-url origin`，确认显示的是自己准备发布的公开仓库。后面的命令都在这个目录执行。

5. **安装依赖并检查发布条件。** 先运行 `pnpm --version`。如果找不到 pnpm 或显示的版本和 `10.24.0` 不同，执行 `npm install --global pnpm@10.24.0`。装好后用下面两条命令安装项目依赖并运行预检。

   ```sh
   pnpm install --frozen-lockfile
   pnpm release:desktop --check
   ```

   看到「发布条件检查通过」就可以开始本机发版。若检查报错，按提示处理后再检查。

## 每次发布

1. 在项目中打开 `package.json`，检查最上面的 `version`。第一次可以沿用当前版本号，再次发给同一平台时换用更高版本号，例如从 `2.8.0` 改为 `2.8.1`。将这次给用户看的改动写进 `dev_tools/release-notes.md`。
2. 用平时的 Git 工具把要发布的改动提交并推送到自己的仓库。可以在 GitHub Desktop 的 **Changes** 页面提交，再点 **Push origin**。Windows 和 Mac 要发同一版时，在两台电脑上使用同一个已推送的提交。
3. 在项目目录运行以下命令。两种系统用同一条命令，只发布当前平台。

```sh
pnpm release:desktop
```

命令会在本机构建，再上传到自己的 GitHub 仓库。成功后打开终端给出的发行页地址，在 **Assets** 中找到本平台的安装包，把这个地址发给用户。Windows 和 Mac 可以先后发布，不必等另一台电脑在线。如果在 GitHub 页面手动查找，请打开仓库的 **Releases** 列表，选择对应版本的 Windows 或 macOS 条目。

| 使用者的电脑 | 首次安装时下载 |
| --- | --- |
| Windows，常见的 Intel 或 AMD 电脑 | `Biu-<版本>-win-setup-x64.exe` |
| Windows，系统类型显示 ARM | `Biu-<版本>-win-setup-arm64.exe` |
| Mac，「关于本机」显示 Apple 芯片 | `Biu-<版本>-mac-arm64.dmg` |
| Mac，「关于本机」显示 Intel 处理器 | `Biu-<版本>-mac-x64.dmg` |

Windows 安装版的用户从第二版起可以在设置中「检查更新」，下载并安装新版。Mac 用户下载新版 DMG，把 Biu 拖入「应用程序」覆盖安装。Windows 便携版也通过手动下载更换。旧版若一直从另一个站点或另一个 fork 检查更新，须先从当前 fork 的发行页手动覆盖安装一次。[升级和卸载](升级和卸载.md)

## 备份 Windows 更新签名密钥

第一次从 Windows 发布时，工具会为这个仓库生成签名私钥，把对应公钥登记到仓库并内置到安装包。看到终端显示密钥路径时，把私钥文件做一份加密备份。默认位置如下，其中 `<账号>`、`<仓库>` 对应自己的 GitHub 仓库。

```text
%USERPROFILE%\.config\biu\github\<账号>\<仓库>\update-signing-ed25519.pem
```

以后用这台电脑发布会自动沿用这把密钥。即使首次上传中断，只要公钥已登记，下次就需要原私钥。换 Windows 电脑发布时，先把备份恢复到相同的用户目录相对路径，再运行发布命令。私钥和备份都丢失后，这条 Windows 通道就无法继续签发更新。私钥留在发布者手里，不要放进 Git 仓库或当作附件上传。只发布 Mac 时可跳过备份。

## 常见问题

- **终端提示找不到 `package.json` 或 `dev_tools`。** 确认终端已进入项目文件夹。Windows 可在文件资源管理器打开项目文件夹，在地址栏输入 `cmd` 并回车。
- **仓库、权限或提交检查失败。** 用 `git remote get-url origin` 核对仓库，用 `gh auth status` 核对登录账号。确认本次提交已推送到该仓库，并且账号有发布权限。
- **提示无法准备 Windows 打包工具 `winCodeSign`。** 首次 Windows 打包会从 GitHub 下载并校验这份工具。检查能否访问 GitHub Releases，连通后用同一提交重新运行。成功下载后会复用缓存。
- **上传中断。** 在同一提交下重新运行发布命令。附件传齐后，这个平台的版本才会公开。已公开版本如需修正，更新版本号后重新发布。[GitHub CLI 的附件发布流程](https://cli.github.com/manual/gh_release_create)

已经运营自己的 HTTPS 下载站、要继续通过 SFTP 上传，可按[自建更新站](服务器首次配置.md)操作。
