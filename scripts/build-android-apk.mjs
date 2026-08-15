import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "../package.json" with { type: "json" };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID_DIR = resolve(ROOT, "android");
const isWindows = process.platform === "win32";

const run = (command, args, cwd = ROOT, env = process.env) => {
  const result = spawnSync(command, args, {
    cwd,
    env,
    shell: isWindows,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const isRelease = process.argv.includes("--release");
const variant = isRelease ? "release" : "debug";

const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, "Android", "Sdk"),
  resolve(homedir(), "Library", "Android", "sdk"),
  "/opt/homebrew/share/android-commandlinetools",
  "/usr/local/share/android-commandlinetools",
].filter(Boolean);
const androidSdk = sdkCandidates.find(candidate => existsSync(resolve(candidate, "platforms")));
const hasLocalProperties = existsSync(resolve(ANDROID_DIR, "local.properties"));

if (!androidSdk && !hasLocalProperties) {
  console.error(
    "找不到 Android SDK。请设置 ANDROID_HOME，或在 android/local.properties 中配置 sdk.dir；详见 docs/android/Android 调试.md。",
  );
  process.exit(1);
}

if (isRelease && !existsSync(resolve(ANDROID_DIR, "keystore.properties"))) {
  console.error("Release APK 需要 android/keystore.properties；配置方法见 docs/android/Android 调试.md。");
  process.exit(1);
}

run(isWindows ? "corepack.cmd" : "corepack", ["pnpm", "build:android"]);
run(
  isWindows ? "gradlew.bat" : "./gradlew",
  [`assemble${variant[0].toUpperCase()}${variant.slice(1)}`],
  ANDROID_DIR,
  androidSdk
    ? { ...process.env, ANDROID_HOME: androidSdk, ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT ?? androidSdk }
    : process.env,
);

const source = resolve(ANDROID_DIR, "app", "build", "outputs", "apk", variant, `app-${variant}.apk`);
if (!existsSync(source)) {
  console.error(`Gradle 已结束，但没有找到 APK：${source}`);
  process.exit(1);
}

const destination = resolve(ROOT, "dist", "artifacts", `Biu-${pkg.version}-android-${variant}.apk`);
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);

console.log(`APK 已生成：${destination}`);
