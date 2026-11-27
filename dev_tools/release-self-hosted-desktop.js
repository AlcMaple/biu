import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

  run("check-update-publish", platform, "--config-only");
  run("upload-update", platform, "--check");
  if (args.includes("--check")) return;

  if (windows) execFileSync("cmd.exe", ["/d", "/c", "pnpm run build"], options);
  else execFileSync("pnpm", ["run", "build"], options);

  if (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version !== version) {
    throw new Error("构建期间版本号已更改，请重新执行发布。");
  }
  run("check-update-publish", platform);
  run("upload-update", platform);
  for (const target of windows ? ["--x64", "--arm64"] : ["--mac"]) {
    run("verify-update-manifest", target, "--version", version);
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
