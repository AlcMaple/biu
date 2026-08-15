# iOS 无真机调试、构建与发布

Biu 的 iOS 端是 Capacitor 容器，与 Android、Electron 和 Web 共用同一套 React 路由、Zustand 状态和业务逻辑。`ios/` 只负责 Xcode 容器、签名、图标、启动图、隐私清单和 Swift Package Manager 依赖。

## 当前结论

已完成：

- Capacitor 8.3.1 iOS Swift Package Manager 工程。
- iOS Deployment Target 15.0。
- iOS 原生检测、共享移动 UI、Preferences / UserDefaults、CapacitorCookies 和 CapacitorHttp 适配。
- 四向安全区、Biu App Icon / Launch Screen、Preferences 所需 `PrivacyInfo.xcprivacy`。
- `package.json` 版本同步到 Xcode `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`。
- `pnpm build:ios` 的 renderer 构建与 `cap sync ios`。

当前这台 Mac 不能运行 iOS native build 或 Simulator：

- 系统是 macOS 14.3。
- 只安装 `/Library/Developer/CommandLineTools`，没有完整 Xcode；`xcodebuild` 和 `simctl` 不可用。
- Capacitor 8 至少要求 Xcode 26.0。Apple 当前兼容矩阵中，Xcode 26.0–26.3 支持 macOS Sequoia 15.6 至 Tahoe 26.x；Xcode 26.4.1–26.6 只支持 macOS Tahoe 26.2–26.x。

因此当前验证到的是“iOS 工程 + 共享渲染层 + Capacitor sync”，不包括 Xcode 原生编译、Simulator、真机、签名 IPA、Cookie / CDN 播放或后台音频。

## 1. 准备 Xcode 环境

1. 先选择一组 Apple 明确支持的系统与 Xcode：macOS 15.6 可安装 Xcode 26.0–26.3；若安装 Xcode 26.4.1–26.6，需先升级到 macOS Tahoe 26.2 或更高版本。
2. 安装所选 Xcode，首次启动时安装 iOS Simulator runtime 并接受许可。不要只按“最新 26.x”下载，先核对 Apple 的系统要求矩阵。
3. 如果当前仍指向 Command Line Tools，切换：

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
```

4. 验证：

```bash
xcodebuild -version
xcrun simctl list runtimes
xcrun simctl list devices
```

Capacitor 8 默认使用 Swift Package Manager，本项目不需要 CocoaPods；没有 `pod` 命令不是阻塞。

## 2. 构建与运行 Simulator

安装锁定依赖：

```bash
pnpm install --frozen-lockfile
```

构建共享 renderer 并同步到 iOS 工程：

```bash
pnpm build:ios
```

这一步只能证明 Web bundle 和 Capacitor sync 成功，不等于 Xcode 原生编译成功。

列出可用 Simulator：

```bash
pnpm exec cap run ios --list
```

构建、同步、选择目标并运行：

```bash
pnpm run:ios
```

指定 target 时，把变量值换成 `--list` 输出的 Simulator ID，再显式执行：

```bash
TARGET_ID="替换为上一条命令显示的 Simulator ID"
pnpm build:ios
pnpm exec cap run ios --no-sync --target "$TARGET_ID"
```

或打开 Xcode：

```bash
pnpm open:ios
```

在 Xcode 中选择 `App` scheme 和一台 iPhone Simulator，然后 Run。

## 3. iOS Live Reload（待 Simulator 验证）

当前工程没有为 HTTP 本地开发服务器加入 ATS 例外，本轮也无法启动 Simulator 验证，因此以下是候选调试流程，不是已通过结论。优先使用 `localhost`，不要直接改成 `127.0.0.1`：iOS 17 起，ATS 默认不再允许 IP literal 连接。

终端 A：

```bash
pnpm dev:ios
```

终端 B：

```bash
pnpm exec cap run ios --list
TARGET_ID="替换为上一条命令显示的 Simulator ID"
pnpm exec cap run ios \
  --target "$TARGET_ID" \
  --live-reload \
  --host localhost \
  --port 5678
```

iOS Simulator 不使用 Android 的 `adb reverse`。Rsbuild 已开启 `strictPort`；5678 被占用时会直接报错。如果 Simulator 白屏或日志显示 ATS 拒绝 HTTP，先回到第 2 节使用离线 bundle；确需 Live Reload 时，只为 Xcode Debug 配置加入最窄的 `NSAllowsLocalNetworking` 例外并完成原生验证，不要给 Release 配置开启全局 `NSAllowsArbitraryLoads`。

WebView 调试：在 Safari 设置中开启开发者菜单，然后从 Develop 菜单选择对应 Simulator 与 Biu WebView。Safari Web Inspector 主要观测 renderer；启用 `CapacitorHttp` 后，请求由原生 URLSession 发出，通常不会完整出现在 Safari Network 面板，应结合 Xcode 日志、Instruments 或系统代理检查。

## 4. Simulator 回归清单

1. 冷启动、路由、移动顶栏、侧栏抽屉、播放栏、全屏页。
2. 竖屏 / 横屏，刘海、状态栏、左右安全区和 Home Indicator。
3. 登录、Cookie / API 请求、基础音频播放、seek 与换源。
4. 修改设置、关闭 App 并重开，确认 UserDefaults 持久化。
5. 使用 Safari Web Inspector 检查 JS 错误、网络请求和媒体失败。

Simulator 仍不能代替真机验证后台音频、锁屏控制、蓝牙耳机键、音频中断、麦克风、功耗、真实触控和移动网络切换。

## 5. 版本、隐私与原生资源

- `scripts/sync-ios-version.mjs` 在 `dev:ios`、`build:ios`、`open:ios` 前同步版本。
- 稳定版 2.5.3 映射为 `MARKETING_VERSION=2.5.3`、`CURRENT_PROJECT_VERSION=20500399`。预发布渠道使用构建号区分。
- `PrivacyInfo.xcprivacy` 为 Preferences / UserDefaults 声明 `NSPrivacyAccessedAPICategoryUserDefaults` 和原因 `CA92.1`。
- App Icon 为 1024×1024 RGB 无 alpha，Launch Screen 使用 Biu 品牌图。
- `ios/App/CapApp-SPM/Package.swift` 由 Capacitor sync 管理，不要手动维护插件路径。

## 6. 真机、Archive 与 IPA 边界

Simulator 产物不是真机 IPA，不能直接发给 iPhone 安装。

个人真机调试不要求付费加入 Apple Developer Program。使用免费 Apple Account / Personal Team 时，需要：

- 在 Xcode 登录 Apple Account，并选择 Personal Team 让 Xcode 自动管理 development provisioning profile。
- 真实设备并在 Xcode 中完成信任 / Developer Mode 配置。
- 确认 Bundle ID `com.biu.app` 可在当前开发者账号注册。

Personal Team 的 App ID、设备数、App 数和 provisioning profile 有期限及数量限制，只适合本人设备开发测试。

发布流程：

1. 上传前更新 `package.json` 版本，并确认生成的 `CURRENT_PROJECT_VERSION` 从未成功上传过；当前脚本不支持在同一 package version 下单独递增 build number。
2. `pnpm build:ios`。
3. `pnpm open:ios`。
4. 在 Xcode 中选择 Generic / Any iOS Device。
5. Product → Archive，在 Organizer 中进行验证和分发。

向其他人进行 Ad Hoc、TestFlight 或 App Store 分发需要 Apple Developer Program（Enterprise 内部分发则需要对应资格），以及相应证书和 provisioning profile；Personal Team 不能用于这些发布渠道。签名账号、Team ID、证书和 profile 不写入仓库。

## 7. 当前功能边界

已接代码但仍需 Simulator / 真机验证：Preferences、CapacitorCookies、CapacitorHttp、B 站登录 Cookie、媒体 CDN 播放与横竖屏安全区。

仍为 noop 或尚未实现：听歌识曲、MediaSession / iOS Audio Session（后台播放、锁屏、耳机键、音频中断）、字体、下载、本地音乐扫描、WhisperX 和桌面歌词。

“`pnpm build:ios` 成功”不得改写为“iOS App 已编译 / 已可发布”。

## 8. 常见故障

| 现象 | 检查 |
| --- | --- |
| `xcodebuild` 要求完整 Xcode | 按 Apple 兼容矩阵升级 macOS、安装至少 Xcode 26.0，然后用 `xcode-select` 切换 |
| `simctl` 不存在 | 当前只有 Command Line Tools，或未安装 iOS Simulator runtime |
| `webDir` / `dist/web` 不存在 | 先运行 `pnpm build:ios`；`run:ios` 已自动先构建 |
| SPM 依赖无法解析 | 先 `pnpm install --frozen-lockfile`，再 `pnpm build:ios`，不要手改生成的 Package.swift 路径 |
| Simulator Live Reload 白屏 | 先改用离线 bundle；再检查 5678、dev server、host / port 和 ATS 日志，确需 HTTP 时仅给 Debug 配置加本地网络例外 |
| 真机签名失败 | 检查 Team、Bundle ID、证书、profile 和设备 Developer Mode |

## 官方参考

- [Capacitor iOS](https://capacitorjs.com/docs/ios)
- [Capacitor run 命令](https://capacitorjs.com/docs/cli/commands/run)
- [Capacitor Live Reload](https://capacitorjs.com/docs/guides/live-reload)
- [Capacitor Preferences 与 Privacy Manifest](https://capacitorjs.com/docs/apis/preferences)
- [Apple：在 Simulator 或真机上运行 App](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
- [Apple：ATS 本地网络例外](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking)
- [Apple：开发者账号与 Personal Team](https://developer.apple.com/help/account/basics/about-your-developer-account)
- [Apple：Beta 与正式分发](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases/)
- [Apple：Xcode 系统要求](https://developer.apple.com/xcode/system-requirements)
- [Apple：Xcode 26 Release Notes](https://developer.apple.com/documentation/Xcode-Release-Notes/xcode-26-release-notes)
