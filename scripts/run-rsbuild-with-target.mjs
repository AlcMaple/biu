import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [target, command] = process.argv.slice(2);
const targets = new Set(["web"]);
const commands = new Set(["build", "dev"]);

if (!targets.has(target) || !commands.has(command)) {
  console.error("用法：node scripts/run-rsbuild-with-target.mjs <web> <build|dev> [...rsbuild 参数]");
  process.exit(1);
}

process.chdir(ROOT);
process.env.BIU_TARGET = target;
process.argv.splice(2, 1);
const { runCLI } = await import("@rsbuild/core");
runCLI();
