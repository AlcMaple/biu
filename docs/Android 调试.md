# Android 调试与发布

## 调试（Live Reload）

### 1. 查 Mac 在局域网的 IP

```bash
ipconfig getifaddr en0
```

### 2. 同步配置 + 装 debug APK（换 IP 需重跑）

```bash
BIU_DEV_URL=http://<MAC_IP>:5678 npx cap sync android
cd android
./gradlew assembleDebug
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
cd ..
```

### 3. 启动 dev server

```bash
pnpm dev:android
```

手机打开 Biu，改代码即热更新。调 Web 层在 Chrome 访问 `chrome://inspect`。

---

## 发布 Release APK

### 1. 生成 keystore（仅首次）

macOS / Linux：

```bash
mkdir -p ~/.biu
keytool -genkey -v \
  -keystore ~/.biu/biu-release.keystore \
  -alias biu \
  -keyalg RSA -keysize 2048 -validity 36500
```

Windows（PowerShell）：

```powershell
mkdir $HOME\.biu -Force
keytool -genkey -v -keystore $HOME\.biu\biu-release.keystore -alias biu -keyalg RSA -keysize 2048 -validity 36500
```

敲下去会交互式问一串东西，按顺序处理：

| 提示 | 怎么填 |
| --- | --- |
| `Enter keystore password:` | 自己设一个密码（至少 6 位），记住 |
| `Re-enter new password:` | 再输一次同样的密码确认 |
| `What is your first and last name?` | 随便填，回车也行 |
| `What is the name of your organizational unit?` | 回车跳过 |
| `What is the name of your organization?` | 回车跳过 |
| `What is the name of your City or Locality?` | 回车跳过 |
| `What is the name of your State or Province?` | 回车跳过 |
| `What is the two-letter country code for this unit?` | 回车跳过 |
| `Is CN=Unknown, OU=Unknown, ... correct?` | 输 `y` 回车 |
| `Enter key password for <biu>` <br> `(RETURN if same as keystore password):` | **直接回车**，让 key 密码和 keystore 密码一致（最省事） |

最后终端会提示 keystore 生成位置。**务必备份这个 `.keystore` 文件和密码**，丢了以后就没法给同一个应用发更新了。

### 2. 配置签名

> **机器维度和仓库维度的区分**
>
> - `keystore.properties` 和 `.keystore` 文件 **不提交**，每台机器各自一份（路径按本机填）。
> - `build.gradle` 是 **提交** 到仓库的，但它只从 properties 里读路径，不写死，所以 macOS / Windows 共用同一份，首次改完之后两边都不用再动。
>
> 如果你在 Mac 和 Windows 上都要出包给同一个应用发布，**必须用同一个 `.keystore` 文件**（把它从一台机器拷到另一台机器），否则两边签出来的包算不同 App，用户无法覆盖升级。

#### 2.1 新建 `android/keystore.properties`（每台机器各建一次）

只在**当前这台机器**上建，路径写本机的实际路径。

macOS / Linux：

```properties
storeFile=/Users/你的用户名/.biu/biu-release.keystore
storePassword=你的密码
keyAlias=biu
keyPassword=你的密码
```

Windows（路径用正斜杠，或者用双反斜杠；**别用单反斜杠**，Gradle 会把它当转义符）：

```properties
storeFile=C:/Users/你的用户名/.biu/biu-release.keystore
storePassword=你的密码
keyAlias=biu
keyPassword=你的密码
```

#### 2.2 加到 `.gitignore`（项目根目录，只需加一次，提交到仓库）

```bash
echo "android/keystore.properties" >> .gitignore
```

#### 2.3 改 `android/app/build.gradle`（提交到仓库，两个平台共用）

当前文件开头是这样：

```gradle
apply plugin: 'com.android.application'

android {
    namespace = "com.biu.app"
    ...
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

做两处改动：

**① 在文件最顶部（`apply plugin` 之后）加载 properties 文件：**

```gradle
apply plugin: 'com.android.application'

def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    ...
```

**② 在 `android { }` 里、`buildTypes` 之前加 `signingConfigs`；同时在已有的 `release { }` 里加一行 `signingConfig`：**

```gradle
android {
    namespace = "com.biu.app"
    compileSdk = rootProject.ext.compileSdkVersion
    defaultConfig {
        ...
    }

    signingConfigs {
        release {
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

注意 **不要新建一个 `release { }` 块**，是往已经存在的那个里加 `signingConfig signingConfigs.release` 这一行。

### 3. 打包

macOS / Linux：

```bash
unset BIU_DEV_URL BIU_TARGET
pnpm build:android
cd android
./gradlew assembleRelease
```

Windows（PowerShell）：

```powershell
Remove-Item Env:BIU_DEV_URL -ErrorAction SilentlyContinue
Remove-Item Env:BIU_TARGET  -ErrorAction SilentlyContinue
pnpm build:android
cd android
.\gradlew.bat assembleRelease
```

产物：`android/app/build/outputs/apk/release/app-release.apk`

### 4. 安装验证

```bash
adb uninstall com.biu.app                  # 先卸载 debug 版（签名不同会冲突）
adb install app/build/outputs/apk/release/app-release.apk
```
