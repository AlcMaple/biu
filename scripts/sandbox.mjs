// 本地沙盒：不用 B 站账号测整条链路（设计见 docs/ideas/008-本地沙盒测试.md）。
// 一起起两个进程：mock 模式的对齐服务 + BIU_TARGET=sandbox 的 Web dev；任一退出就全部退出。
// 用法：pnpm sandbox            启动
//       pnpm sandbox --reset    先清空对齐服务的沙盒数据（报错、提交、对齐结果）再启动
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkSandboxPorts, parseSandboxOptions, sandboxHelp, sandboxWebOrigin } from "./sandbox-options.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
// 和 shared/sandbox.ts 里「管理员」身份的 mid 一致（这里是纯 JS，读不了那份 TS）
const ADMIN_MID = "900009";

let options;
try {
  options = parseSandboxOptions(process.argv.slice(2));
  if (options.help) {
    console.log(sandboxHelp);
    process.exit(0);
  }
  await checkSandboxPorts(options);
} catch (error) {
  console.error(`[sandbox] ${error.message}`);
  process.exit(1);
}
const { port, alignPort: ALIGN_PORT, dataRoot: DATA_ROOT } = options;

if (options.reset) {
  rmSync(DATA_ROOT, { recursive: true, force: true });
  console.log(`[sandbox] 已清空 ${DATA_ROOT}`);
}

// 每次启动随机生成：签出来的 token 只在本次的两个进程之间有效，泄露了也冒充不了线上用户
const jwtSecret = randomBytes(32).toString("hex");

const children = [];
let closing = false;
const shutdown = code => {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // 各子进程独立成组，只结束本次启动的 pnpm/tsx/rsbuild 后代，不按端口杀其他沙箱。
    if (!isWindows && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") console.error(`[sandbox] 关闭子进程失败：${error.code}`);
      }
    } else child.kill();
  }
  process.exit(code);
};

function run(name, command, args, options) {
  const child = spawn(isWindows ? `${command}.cmd` : command, args, {
    stdio: "inherit",
    shell: isWindows,
    detached: !isWindows,
    ...options,
  });
  child.on("error", error => {
    console.error(`[sandbox] ${name} 启动失败：${error.code}`);
    shutdown(1);
  });
  child.on("exit", code => {
    console.log(`[sandbox] ${name} 已退出（${code ?? "signal"}），关闭沙盒`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

run("对齐服务", "corepack", ["pnpm", "exec", "tsx", "src/index.ts", "--mock"], {
  cwd: join(ROOT, "biu-align-server"),
  env: {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(ALIGN_PORT),
    JWT_SECRET: jwtSecret,
    ADMIN_MIDS: ADMIN_MID,
    DATA_DIR: join(DATA_ROOT, "align-data"),
    WORK_DIR: join(DATA_ROOT, "align-work"),
    MOCK_DELAY_MS: process.env.MOCK_DELAY_MS ?? "3000",
  },
});

run("Web", "corepack", ["pnpm", "exec", "rsbuild", "dev", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: ROOT,
  env: {
    ...process.env,
    BIU_TARGET: "sandbox",
    BIU_SANDBOX_JWT_SECRET: jwtSecret,
    BIU_SANDBOX_ALIGN_ORIGIN: `http://127.0.0.1:${ALIGN_PORT}`,
  },
});

console.log(`[sandbox] 打开 ${sandboxWebOrigin(port)} ，顶栏中间切换身份`);
console.log(`[sandbox] 对齐服务 http://127.0.0.1:${ALIGN_PORT}；服务数据 ${DATA_ROOT}`);
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
