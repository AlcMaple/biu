# Android 调试与发布

主场是 Electron，Android 只是扩展。本文档的目标是让 Android 侧改 UI 不用每次重打 APK，同时完全不影响 Electron 的日常开发。

## TL;DR

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 日常 Electron 开发 | `pnpm dev` | 行为与改造前一致，自动起 Electron |
| Android 热更新调试 | `pnpm dev:android` + 手机连 Mac 的 dev server | 只跑 Rsbuild，不起 Electron |
| Android 正式出包 | `pnpm build:android` + Gradle | 完全离线，不依赖任何 dev server |

关键点：`pnpm dev:android` 是 **opt-in** 的 —— 不主动跑就完全不影响 Electron 流程。

## Android 调试流程

### 一次性准备

查 Mac 在局域网里的 IP：

```bash
ipconfig getifaddr en0
```

（若走的是 Wi-Fi 以外的接口，用 `ifconfig | grep "inet "` 自己挑一个非 `127.*` 的 IP。）

### 首次安装 Live Reload 版 APK

**每次换 IP 或者重装 APK 都要重跑这几步**（因为 `server.url` 是打进 APK 的 `capacitor.config.json` 里的）：

```bash
# 1. 同步配置到 android/ 工程（把 BIU_DEV_URL 注入进去）
BIU_DEV_URL=http://192.168.x.x:5678 npx cap sync android

# 2. 打一个 debug APK
cd android
./gradlew assembleDebug

# 3. 装到手机
adb devices                 # 确认能看到设备序列号
adb install -r app/build/outputs/apk/debug/app-debug.apk
cd ..
```

### 日常调试循环

一个终端跑 dev server：

```bash
pnpm dev:android
```

手机上打开 Biu，就会加载 `http://192.168.x.x:5678`。之后每次改代码 **Rsbuild HMR 会直接推到手机**，不需要重打 APK。

调 Web 层（DOM/样式/JS）：Chrome 里访问 `chrome://inspect` → 找到设备和页面 → `inspect`。

### 调试时几个常见问题

- **手机打不开页面**：Mac 和手机必须在同一 Wi-Fi；Mac 的防火墙放行 5678。
- **换了 Wi-Fi（IP 变了）**：重跑上面的"首次安装"三步。
- **白屏/加载失败**：确认 `pnpm dev:android` 终端里显示了 `5678` 端口；用手机浏览器直接访问 `http://192.168.x.x:5678` 验证能打开。
- **调用 Bilibili API 报 CORS/网络错**：Android 的网络层走的是 `@capacitor/http`（见 `75ce059`、`5a352a5`、`62a7990`），这一套在 Live Reload 模式下同样生效，无需额外配置。

## Android 正式发布流程

发版前先检查环境是干净的：

```bash
# 确保当前 shell 没有残留的调试环境变量
unset BIU_DEV_URL
unset BIU_TARGET
```

然后打离线包：

```bash
# 1. 生产构建 + 同步到 android/ 工程（此时 server.url 不会写入）
pnpm build:android

# 2. 打 release APK（按实际签名配置调整）
cd android
./gradlew assembleRelease
# 或者要 AAB 走 Google Play：
# ./gradlew bundleRelease
```

产物位置：

- APK：`android/app/build/outputs/apk/release/app-release.apk`
- AAB：`android/app/build/outputs/bundle/release/app-release.aab`

### 出包前自检清单

- [ ] `capacitor.config.ts` 里没有写死的 `server.url`（改造后已经走环境变量，正常情况下不用管）
- [ ] 当前 shell 没有 `BIU_DEV_URL` / `BIU_TARGET`
- [ ] 手机卸载掉之前装的 debug 版（签名不同会冲突）
- [ ] 在飞行模式/断开 Mac 的情况下跑一遍 release APK，确认是真的离线包，不是还在偷偷连 dev server

### 首次发布需要的签名配置

Android release 必须签名。项目目前没有把签名配置提交到仓库，第一次发版时需要：

1. 用 `keytool` 生成一个 keystore 文件（保存到 `android/` 外面，不要提交）
2. 在 `android/app/build.gradle` 里配置 `signingConfigs.release`
3. keystore 口令建议走环境变量或 `~/.gradle/gradle.properties`

这部分属于首次发版的一次性工作，之后直接 `./gradlew assembleRelease` 即可。
