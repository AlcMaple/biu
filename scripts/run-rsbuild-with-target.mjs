import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [target, command, ...args] = process.argv.slice(2);
const targets = new Set(["android", "ios", "web"]);
const commands = new Set(["build", "dev"]);

if (!targets.has(target) || !commands.has(command)) {
  console.error("用法：node scripts/run-rsbuild-with-target.mjs <android|ios|web> <build|dev> [...rsbuild 参数]");
  process.exit(1);
}

const isWindows = process.platform === "win32";
const result = spawnSync(isWindows ? "corepack.cmd" : "corepack", ["pnpm", "exec", "rsbuild", command, ...args], {
  cwd: ROOT,
  env: { ...process.env, BIU_TARGET: target },
  shell: isWindows,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
