import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { getDesktopReleaseArtifacts } from "./update-artifacts.js";
import { loadUpdateEnvironment } from "./update-env.js";

const root = path.resolve(import.meta.dirname, "..");

export function releaseSelfHostedDesktop(args, system = process.platform) {
  if (args.includes("--help")) {
    console.log("pnpm release:desktop          打包并发布到自建更新站\npnpm release:desktop --check  只检查发布条件");
    return;
  }
  if (args.some(arg => arg !== "--check")) throw new Error("可用参数为 --check 或 --help。");
  if (system !== "win32" && system !== "darwin") throw new Error("请在 Windows 或 macOS 上发布相应的桌面版。");

  const windows = system === "win32";
  const platform = windows ? "--win" : "--mac";
  const environment = { ...process.env, BIU_TARGET: "electron" };
  delete environment.BIU_GITHUB_RELEASE_REPO;
  delete environment.BIU_GITHUB_UPDATE_PUBLIC_KEY;
  loadUpdateEnvironment({ environment });

  const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const options = { cwd: root, env: environment, stdio: "inherit" };
  const run = (script, ...flags) => execFileSync(process.execPath, [`dev_tools/${script}.js`, ...flags], options);

  const platformName = windows ? "Windows" : "macOS";
  console.log(`[预检] Biu ${version} · ${platformName}`);
  run("check-update-publish", platform, "--config-only");
  run("upload-update", platform, "--check");
  if (args.includes("--check")) {
    console.log("预检通过。本次未构建、未上传。");
    return;
  }

  console.log(`[构建] 正在打包 ${platformName} x64 和 ARM64`);
  if (windows) execFileSync("cmd.exe", ["/d", "/c", "pnpm run build"], options);
  else execFileSync("pnpm", ["run", "build"], options);

  if (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version !== version) {
    throw new Error("构建期间版本号已更改，请重新执行发布。");
  }
  getDesktopReleaseArtifacts(path.join(root, "dist", "artifacts"), version, windows ? "win" : "mac");
  console.log(`[上传] 正在连接自建更新站，准备上传 ${version}`);
  run("upload-update", platform);
  console.log("[验证] 正在读取线上更新清单");
  for (const target of windows ? ["--x64", "--arm64"] : ["--mac"]) {
    run("verify-update-manifest", target, "--version", version, ...(windows ? ["--blockmap"] : []));
  }
  console.log(`Biu ${version} 已发布到自建更新站，线上更新清单验证通过。`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    releaseSelfHostedDesktop(process.argv.slice(2));
  } catch (error) {
    if (error.status == null) console.error(error.message);
    process.exitCode = error.status || 1;
  }
}
