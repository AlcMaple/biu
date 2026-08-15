# Android 无真机调试、APK 构建与发布

本文以“只有 Mac，没有 Android 真机”为前提。Android Studio 不是 CLI 模拟器和 APK 构建的必需条件；但模拟器只能完成共享 UI 和基础运行回归，不能代替最终真机验收。

## 命令边界

| 命令                             | 实际作用                                                |
| -------------------------------- | ------------------------------------------------------- |
| `pnpm dev:android`               | 只启动 Android 目标的 Rsbuild 开发服务器，不安装 App    |
| `pnpm build:android`             | 构建 `dist/web` 并 `cap sync android`，不生成 APK       |
| `pnpm build:android:apk`         | 构建、同步、`assembleDebug`，输出可直接安装的 debug APK |
| `pnpm build:android:apk:release` | 读取本机签名配置，输出已签名 release APK                |
| `pnpm open:android`              | 用 Android Studio 打开原生工程；CLI 路线不依赖它        |

APK 构建脚本会主动删除残留的 `BIU_DEV_URL`，所以 debug / release APK 始终使用包内离线资源。

## 1. 环境准备

当前工程约束：

- Node.js 22.17.1，pnpm 10.24.0，JDK 21。
- Android compile / target API 36，最低 API 24。
- Gradle 8.14.3，Android Gradle Plugin 8.13。
- Apple Silicon 优先使用 `arm64-v8a` 系统镜像；Intel Mac 使用 `x86_64`。

2026-08-15 本轮审计时，这台 Mac 的 SDK 根目录是 `/opt/homebrew/share/android-commandlinetools`。走本文完整 CLI 流程时，在当前 shell 设置：

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

如果只需要让 Gradle 找到 SDK，也可在被 Git 忽略的 `android/local.properties` 中写：

```properties
sdk.dir=/opt/homebrew/share/android-commandlinetools
```

`local.properties` 不会为 `sdkmanager`、`emulator`、`adb` 或 `apksigner` 配置命令路径；执行后续 CLI 流程仍需设置 `ANDROID_HOME` / `ANDROID_SDK_ROOT` 和 `PATH`。

先检查环境：

```bash
node -v
corepack pnpm -v
java -version
sdkmanager --version
adb version
```

## 2. 安装 CLI 模拟器

2026-08-15 本轮审计时，这台 Mac 已有 JDK、ADB、API 34 / 36 和 Build Tools 34 / 35，但没有 `emulator`、ARM64 system image 或 AVD。按需安装并创建 API 36 模拟器：

```bash
sdkmanager --licenses
sdkmanager \
  "platform-tools" \
  "platforms;android-36" \
  "build-tools;35.0.0" \
  "emulator" \
  "system-images;android-36;google_apis;arm64-v8a"

avdmanager create avd \
  --name Biu_API_36 \
  --package "system-images;android-36;google_apis;arm64-v8a" \
  --device pixel_7
```

不使用 `--force`，避免覆盖已有 AVD。如果同名 AVD 已存在，先查询：

```bash
avdmanager list avd
emulator -list-avds
```

终端 A 启动模拟器，并保持进程运行：

```bash
emulator -avd Biu_API_36
```

终端 B 等待 ADB 连接，再等待 Android 完成开机：

```bash
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
adb devices -l
```

可再创建 API 24 AVD 做最低系统回归，但主功能先在 API 36 验证。

## 3. 离线 debug APK

构建：

```bash
pnpm build:android:apk
```

会得到两个等价文件：

- Gradle 原始产物：`android/app/build/outputs/apk/debug/app-debug.apk`。
- 便于交付的版本化副本：`dist/artifacts/Biu-<package.json 版本>-android-debug.apk`。

安装到已启动的模拟器：

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

2026-08-15 本轮对 2.5.3 实测产物的关键属性：

- package `com.biu.app`，`versionName 2.5.3`，`versionCode 20500399`。
- minSdk 24，target / compile 36。
- Android Debug 证书，APK Signature Scheme v2。
- 该产物无 native `.so`，所以是不限 ABI 的通用 APK；引入原生插件后需重新审计。

Debug key 每台开发机可能不同，只适合本地测试。如果遇到 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，说明已安装包的签名不同。只有确认可以丢失本地数据时才执行：

```bash
adb uninstall com.biu.app
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

`adb uninstall` 会清除 Preferences、Cookie 等 App 本地数据。

## 4. Live Reload（无需局域网 IP）

两个终端都要保持运行。

终端 A：

```bash
pnpm dev:android
```

终端 B 先查目标：

```bash
pnpm exec cap run android --list
```

然后把变量值改成上一步显示的 target ID：

```bash
TARGET_ID=emulator-5554
pnpm exec cap run android \
  --target "$TARGET_ID" \
  --live-reload \
  --host 127.0.0.1 \
  --port 5678 \
  --forwardPorts 5678:5678
```

`--forwardPorts` 会执行等价的 `adb reverse`，把模拟器的 5678 转到 Mac 的 5678，不需要 `10.0.2.2`、局域网 IP 或手工设置 `BIU_DEV_URL`。可检查：

```bash
adb reverse --list
```

Rsbuild 已开启 `strictPort`；5678 被占用时会直接报错，不会偷换到其他端口。用 `Ctrl+C` 正常结束 Capacitor 命令，便于它恢复临时 Live Reload 配置。如果曾强制终止，先清除可能残留的开发地址，再同步回离线配置：

```bash
unset BIU_DEV_URL
pnpm build:android
```

## 5. 观测与回归

常用命令：

```bash
adb devices -l
adb logcat
adb shell am force-stop com.biu.app
```

WebView 调试：桌面 Chrome 打开 `chrome://inspect/#devices`，在 `com.biu.app` 对应 WebView 下点 Inspect。

模拟器至少回归：

1. 启动、路由、侧栏抽屉、播放栏、全屏页和横竖屏安全区。
2. 登录、Cookie / API 请求、基础播放与 seek。
3. 修改设置后 `force-stop` 并重开，确认 Preferences 和登录态恢复。
4. 网络断开 / 恢复、请求失败和音频换源行为。

## 6. Release 签名 APK

### 6.1 生成并备份 keystore

```bash
mkdir -p ~/.biu
keytool -genkeypair -v \
  -keystore ~/.biu/biu-release.keystore \
  -alias biu \
  -keyalg RSA \
  -keysize 2048 \
  -validity 36500
```

务必备份 keystore、alias 和密码。跨版本、跨构建机必须使用同一把 release key，否则用户无法覆盖升级。密钥丢失会破坏后续侧载升级链。

### 6.2 本机签名配置

创建被 Git 忽略的 `android/keystore.properties`：

```properties
storeFile=/Users/你的用户名/.biu/biu-release.keystore
storePassword=你的密码
keyAlias=biu
keyPassword=你的密码
```

Windows 路径使用正斜杠，例如 `C:/Users/name/.biu/biu-release.keystore`。`keystore.properties`、`*.jks` 和 `*.keystore` 已由 `android/.gitignore` 忽略，不要提交秘密。Gradle 的条件签名逻辑已在仓库中，无需再手改 `build.gradle`。

### 6.3 构建与验签

```bash
pnpm build:android:apk:release
```

产物：

- `android/app/build/outputs/apk/release/app-release.apk`。
- `dist/artifacts/Biu-<版本>-android-release.apk`。

没有 `keystore.properties` 时脚本会在构建前停止；缺字段时 Gradle 会明确报错，不会把 unsigned APK 冒充发布包。验证签名：

```bash
APP_VERSION=$(node -p "require('./package.json').version")
RELEASE_APK="dist/artifacts/Biu-${APP_VERSION}-android-release.apk"
"$ANDROID_HOME/build-tools/35.0.0/apksigner" \
  verify --verbose --print-certs \
  "$RELEASE_APK"
```

安装并启动 release 包做 smoke test：

```bash
APP_VERSION=$(node -p "require('./package.json').version")
RELEASE_APK="dist/artifacts/Biu-${APP_VERSION}-android-release.apk"
adb install -r "$RELEASE_APK"
adb shell am start -n com.biu.app/.MainActivity
```

如果模拟器中已经安装 debug 包，release 证书不同会触发 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`；确认可丢弃本地数据后，先 `adb uninstall com.biu.app` 再安装 release 包。

2026-08-15 本轮审计时，这台 Mac 没有 release keystore，因此只实测了“缺密钥时构建前停止”；配置真实密钥后必须完成验签、安装和启动检查。

`versionName` 直接来自 `package.json`；`versionCode` 由 SemVer 与 alpha / beta / rc 渠道顺序计算。

## 7. 验证边界

已接入代码：共享 React UI、Preferences、CapacitorCookies、CapacitorHttp，以及 Android MainActivity 的 B 站 Referer / CDN 拦截。

仍为 noop 或尚未实现：听歌识曲、MediaSession（后台播放 / 通知 / 锁屏 / 耳机键 / AudioFocus）、字体、窗口控制、下载、本地音乐扫描、WhisperX 和桌面歌词。

仍必须真机验证：厂商 WebView 差异、真实触控热区与刘海 / 手势区、蓝牙耳机键、后台 / 锁屏、AudioFocus、麦克风、功耗和网络切换。APK 构建成功不等于 Android 运行时已验收。

## 8. 常见故障

| 现象 | 检查 |
| --- | --- |
| `SDK location not found` | 设置 `ANDROID_HOME` / `ANDROID_SDK_ROOT`，或写 `android/local.properties` |
| 没有可用 target | 安装 emulator / system image，检查 `avdmanager list avd`、`adb devices -l` |
| 白屏或 `ERR_CONNECTION_REFUSED` | 确认 dev server 真正监听 5678、Capacitor 命令仍运行、`adb reverse --list` 有转发 |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 已安装包签名不同；卸载会清空 App 数据 |
| Release 提示缺 keystore / 字段 | 补本机 `android/keystore.properties`，不要提交密钥 |
| 端口 5678 已被占用 | 关闭占用进程后重启；Rsbuild 不会自动换端口 |

## 官方参考

- [sdkmanager](https://developer.android.com/tools/sdkmanager)
- [avdmanager](https://developer.android.com/tools/avdmanager)
- [Android Emulator 命令行](https://developer.android.com/studio/run/emulator-commandline)
- [命令行构建 APK](https://developer.android.com/build/building-cmdline)
- [Android App 签名](https://developer.android.com/studio/publish/app-signing)
