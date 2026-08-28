import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.platform === "win32" ? "corepack.cmd" : "corepack";

const result = spawnSync(command, ["pnpm", "exec", "rsbuild", "build"], {
  cwd: root,
  env: { ...process.env, BIU_TARGET: "demo" },
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
