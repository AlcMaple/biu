# Windows 发版上传 · 免密配置指南

> 这份文件是给「在 Windows 机器上打包并上传更新」用的操作清单。对话发生在 Mac 上，你切到 Windows 后看不到聊天记录，所以所有背景和步骤都写在这一个文件里，照着做即可，做完把每步的「📝 结果」填回来。

---

## 背景（当前进度）

- 版本号已经在另一台机器上升级并 push：当前 `package.json` 版本是 **2.3.2**，commit `chore: 发布 2.3.2` 已经在远端 `master` 上。
- 本次更新内容：修复收藏夹部分视频播放量显示异常的问题（已写进 `dev_tools/release-notes.md`，上传时会自动注入到 `latest.yml`）。
- 你现在要在 **Windows** 上做的事：
  1. **（一次性）配置 SSH 密钥免密** —— 解决「每次 `node dev_tools/upload-update.js` 都要输密码」的痛点。**这是本次重点，先做这个。**
  2. 拉最新代码 → `pnpm build` 打 Windows 安装包 → 上传到服务器。
- 免密原理（无需理解也能操作）：上传脚本启动时会找私钥 `C:\Users\<你>\.ssh\biu_deploy`，找到就免密；找不到才回退到输密码。所以只要把这把私钥配好、并把对应公钥登记到服务器一次，以后永久免密。完整说明见 `docs/自动更新部署指南.md` 第二节。

---

## 环境前提（务必先确认）

- **终端用 PowerShell**（Win11/Win10 自带，开始菜单搜 "PowerShell"）。本文所有命令按 PowerShell 写，`cmd` 的环境变量写法不同，别混用。
- **不需要管理员权限。** 普通 PowerShell 窗口即可。
- 命令里出现的 `<你>` 指你的 Windows 用户名；用 `$env:USERPROFILE` 自动代入，不用手动改。
- 需要系统自带 OpenSSH（Win10 1809+ 默认有）。先验证：

```powershell
# 确认 ssh / ssh-keygen / scp 都在
ssh -V
ssh-keygen --help
```

> 判读：`ssh -V` 打印出 `OpenSSH_x.x` 版本号 = 正常。
> 若提示「无法识别 ssh」= 缺 OpenSSH，去「设置 → 应用 → 可选功能 → 添加功能 → OpenSSH 客户端」装上再继续。

📝 结果：
```

```

- 进入项目目录（把路径换成你机器上 biu 仓库的实际位置）：

```powershell
cd D:\path\to\biu
```

---

## 第一部分（一次性）配置免密 —— 最关键，先做这个

> 这一整部分只在「这台 Windows 机器从没配过」时做一次。做完以后，本机以后所有发版上传都自动免密，不用再碰这部分。
> 如果你之前在这台机器配过，直接跳到「步骤 1.4 验证」确认还有效即可。

### - [ ] 1.1 检查是否已有部署私钥

```powershell
Test-Path "$env:USERPROFILE\.ssh\biu_deploy"
```

> 判读：输出 `True` = 已有私钥，**跳过 1.2、1.3，直接做 1.4 验证**。
> 输出 `False` = 没有，继续 1.2。

📝 结果：
```

```

### - [ ] 1.2 生成专用部署密钥

```powershell
# 确保 .ssh 目录存在（已存在不会报错）
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null

# 生成密钥；运行后会问两次 passphrase，两次都直接按回车（留空），这样才能免密
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\biu_deploy"
```

> 重要：问 `Enter passphrase` 时**直接回车两次留空**。设了密码短语就不是免密了。
> 这里**不要**用 `-N ""`，PowerShell 对空字符串参数解析有坑，反而会设出一个怪密码。交互式回车最稳。
> 完成后 `.ssh` 下会多出 `biu_deploy`（私钥，别外泄、别提交）和 `biu_deploy.pub`（公钥）。

📝 结果（贴出最后几行，比如 `The key's randomart image is...` 那段）：
```

```

### - [ ] 1.3 把公钥登记到服务器（**唯一一次需要输服务器密码**）

```powershell
node dev_tools/upload-update.js --install-key
```

> 会提示「请输入服务器密码」，输入一次服务器（`root@8.163.0.99`）密码。
> 成功标志：看到 `✅ 公钥已写入，后续运行将自动免密登录。`
> 该操作幂等，重复跑也不会写重复行。

📝 结果：
```

```

### - [ ] 1.4 验证免密是否生效

```powershell
# 用部署私钥直连服务器，不应再问密码
ssh -i "$env:USERPROFILE\.ssh\biu_deploy" root@8.163.0.99 "echo OK"
```

> 判读：**没问密码就直接打印 `OK`** = 免密成功，第一部分完成 ✅。
> 仍要求输密码或报 `Permission denied` = 1.3 没成功，回去重做 1.3。
> 首次连接若问 `Are you sure you want to continue connecting (yes/no)?`，输 `yes` 回车（这是认服务器指纹，不是输密码）。

📝 结果：
```

```

---

## 第二部分 每次发版的上传流程

> 第一部分配好后，以后每次发版都只跑这一部分。

### - [ ] 2.1 拉取最新代码

```powershell
git pull
git log --oneline -1
```

> 判读：最后一行应是 `chore: 发布 2.3.2`（或更新的发布 commit）。版本对不上就别往下走。

📝 结果：
```

```

### - [ ] 2.2 安装依赖（保险起见，没变化会很快跳过）

```powershell
pnpm install
```

📝 结果：
```

```

### - [ ] 2.3 打包 Windows 安装包

```powershell
pnpm build
```

> 这一步较慢（几分钟）。完成后产物在 `dist\artifacts\`。
> 验证产物存在：

```powershell
Get-ChildItem dist\artifacts\ | Where-Object Name -like "*2.3.2*win*"
Get-ChildItem dist\artifacts\latest.yml
```

> 判读：应能看到 `Biu-2.3.2-win-setup-x64.exe`、对应 `.blockmap`、以及 `latest.yml`。
> 看不到 = 打包没成功，把 `pnpm build` 的报错贴回来。

📝 结果：
```

```

### - [ ] 2.4 上传到服务器（此时应全程免密）

```powershell
node dev_tools/upload-update.js --win
```

> 成功标志：
> - 第一行打印 `使用 SSH 私钥认证：C:\Users\<你>\.ssh\biu_deploy`（**没有**提示输密码）。
> - 结尾打印 `✅ 上传完成（N/N 个文件）`。
> 若第一行是 `未找到部署私钥...回退到密码认证` = 私钥路径不对，回第一部分检查 `biu_deploy` 是否在 `C:\Users\<你>\.ssh\` 下。

📝 结果：
```

```

### - [ ] 2.5 验证线上已更新

浏览器打开（或用下面命令）确认 `latest.yml` 里的版本是 **2.3.2**：

```powershell
# 直接拉服务器上的 yml 看版本号
curl http://8.163.0.99/biu/updates/latest.yml
```

> 判读：内容里 `version: 2.3.2` + 文件名是 `Biu-2.3.2-win-setup-x64.exe` = 发布成功 ✅。
> 也可在 App「设置 → 关于应用 → 检查更新」实测能否检测到 2.3.2。

📝 结果：
```

```

---

## 做完汇总（一次性贴回来）

请把以下几项结果发回来，我据此判断是否还有问题：

1. 第一部分是否完成（1.4 的 `ssh ... echo OK` 是否免密打印了 OK）？
2. `pnpm build` 后 `dist\artifacts\` 里是否有 `Biu-2.3.2-win-setup-x64.exe` 和 `latest.yml`？
3. `upload-update.js --win` 第一行是不是 `使用 SSH 私钥认证：...`（即没再输密码）？结尾是否 `✅ 上传完成`？
4. `latest.yml` 里的 `version` 是不是 `2.3.2`？

---

## 附：常见问题速查

- **配了密钥还是要输密码** → 确认私钥确实在 `C:\Users\<你>\.ssh\biu_deploy`；脚本找不到才回退密码。第一行输出会告诉你它实际找的是哪条路径。
- **`ssh-keygen` 设了 passphrase 怎么办** → 删掉 `biu_deploy` 和 `biu_deploy.pub` 重做 1.2，passphrase 两次都留空；然后重做 1.3。
- **换新电脑** → 免密绑定的是「本机私钥 ↔ 服务器公钥」，新机器要重新走整个第一部分。
- **找不到 `dist\artifacts\`** → 还没 `pnpm build` 或打包失败。
- 更完整的服务器/Apache/各平台说明见 `docs/自动更新部署指南.md`。
