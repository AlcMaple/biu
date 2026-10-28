// 本地沙盒：不用 B 站账号测整条链路（设计见 docs/ideas/008-本地沙盒测试.md）。
// 一起起两个进程：mock 模式的对齐服务 + BIU_TARGET=sandbox 的 Web dev；任一退出就全部退出。
// 用法：pnpm sandbox            启动
//       pnpm sandbox --reset    先清空对齐服务的沙盒数据（报错、提交、对齐结果）再启动
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const ALIGN_PORT = 3013;
// 放在用户目录而不是系统临时目录：重启电脑后沙盒里造的报错、提交还在，只有 --reset 才清
const DATA_ROOT = join(homedir(), ".biu-sandbox");
// 和 shared/sandbox.ts 里「管理员」身份的 mid 一致（这里是纯 JS，读不了那份 TS）
const ADMIN_MID = "900009";

if (process.argv.includes("--reset")) {
  rmSync(DATA_ROOT, { recursive: true, force: true });
  console.log(`[sandbox] 已清空 ${DATA_ROOT}`);
}

// 每次启动随机生成：签出来的 token 只在本次的两个进程之间有效，泄露了也冒充不了线上用户
const jwtSecret = randomBytes(32).toString("hex");

const children = [];
const shutdown = code => {
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exit(code);
};

function run(name, command, args, options) {
  const child = spawn(isWindows ? `${command}.cmd` : command, args, { stdio: "inherit", shell: isWindows, ...options });
  child.on("exit", code => {
    console.log(`[sandbox] ${name} 已退出（${code ?? "signal"}），关闭沙盒`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

run("对齐服务", "npx", ["tsx", "src/index.ts", "--mock"], {
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

run("Web", "corepack", ["pnpm", "exec", "rsbuild", "dev"], {
  cwd: ROOT,
  env: {
    ...process.env,
    BIU_TARGET: "sandbox",
    BIU_SANDBOX_JWT_SECRET: jwtSecret,
    BIU_SANDBOX_ALIGN_ORIGIN: `http://127.0.0.1:${ALIGN_PORT}`,
  },
});

console.log("[sandbox] 打开 http://localhost:5679 ，顶栏中间切换身份");
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
