import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const root = process.cwd();
const optionsUrl = pathToFileURL(join(root, "scripts/sandbox-options.mjs")).href;
const fixture = mkdtempSync(join(tmpdir(), "biu-launcher-test-"));
const preload = join(fixture, "capture-spawn.mjs");
writeFileSync(
  preload,
  `import childProcess from 'node:child_process';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
fs.rmSync = path => console.log('[captured-delete]'+JSON.stringify(path));
childProcess.spawn = (command, args, options) => {
  const { PORT, DATA_DIR, WORK_DIR, BIU_TARGET, BIU_SANDBOX_UPSTREAM_ORIGIN, BIU_SYNC_INTERNAL_ORIGIN, BIU_ALIGN_INTERNAL_ORIGIN } = options.env;
  console.log('[captured-child]'+JSON.stringify({command,args,cwd:options.cwd,detached:options.detached,env:{PORT,DATA_DIR,WORK_DIR,BIU_TARGET,BIU_SANDBOX_UPSTREAM_ORIGIN,BIU_SYNC_INTERNAL_ORIGIN,BIU_ALIGN_INTERNAL_ORIGIN}}));
  const child = new EventEmitter(); child.exitCode = null; child.pid = 70000 + (++pid);
  child.kill = signal => console.log('[captured-kill-child]'+JSON.stringify([child.pid, signal ?? null]));
  children.push(child);
  if (process.env.BIU_TEST_EXIT_FIRST && children.length === 4) setTimeout(() => { children[0].exitCode = 1; children[0].emit('exit', 1); }, 0);
  return child;
};
let pid = 0;
const children = [];
const realKill = process.kill.bind(process);
process.kill = (target, signal) => {
  if (target < 0) return console.log('[captured-kill-group]'+JSON.stringify([target, signal]));
  return realKill(target, signal);
};
syncBuiltinESMExports();`,
);
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function parse(args: string[]) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {parseSandboxOptions} from ${JSON.stringify(optionsUrl)}; console.log(JSON.stringify(parseSandboxOptions(${JSON.stringify(args)},'/fixture/repo','/fixture/home')))`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  ) as {
    port: number;
    bilibiliPort: number;
    syncPort: number;
    alignPort: number;
    dataRoot: string;
    reset: boolean;
    help: boolean;
  };
}

function launch(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["--import", preload, join(root, "scripts/sandbox.mjs"), ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 10000,
  });
  const children = result.stdout
    .split("\n")
    .filter(line => line.startsWith("[captured-child]"))
    .map(
      line =>
        JSON.parse(line.slice("[captured-child]".length)) as {
          command: string;
          args: string[];
          cwd: string;
          detached: boolean;
          env: Record<string, string>;
        },
    );
  return { ...result, children };
}

async function freePorts(count: number) {
  const ports = new Set<number>();
  while (ports.size < count) ports.add(await freePort());
  return [...ports];
}

async function freePort() {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("缺少本地端口");
  const port = address.port;
  await new Promise<void>((done, reject) => server.close(error => (error ? reject(error) : done())));
  return port;
}

describe("沙箱启动参数", () => {
  it("保留默认localhost来源，避免旧浏览器数据看起来丢失", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {sandboxWebOrigin} from ${JSON.stringify(optionsUrl)};console.log(JSON.stringify([sandboxWebOrigin(5679),sandboxWebOrigin(47001)]))`,
      ],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toEqual(["http://localhost:5679", "http://127.0.0.1:47001"]);
  });
  it("保留默认端口和持久化目录，不隐式清理", () => {
    expect(parse([])).toEqual({
      port: 5679,
      bilibiliPort: 3010,
      syncPort: 3012,
      alignPort: 3013,
      dataRoot: "/fixture/home/.biu-sandbox",
      reset: false,
      help: false,
    });
  });
  it("显式隔离四个端口和含空格的数据路径", () => {
    expect(
      parse([
        "--port",
        "47001",
        "--bilibili-port=47003",
        "--sync-port",
        "47004",
        "--align-port=47002",
        "--data-dir",
        "my fixture data",
      ]),
    ).toMatchObject({
      port: 47001,
      bilibiliPort: 47003,
      syncPort: 47004,
      alignPort: 47002,
      dataRoot: "/fixture/repo/my fixture data",
    });
  });
  it.each(["0", "65536", "-1", "47001x", "1.5"])("拒绝不完整整数端口%s", value => {
    expect(() => parse(["--port", value])).toThrow();
  });
  it.each([
    ["--unknown"],
    ["--port"],
    ["--port", "--data-dir"],
    ["--data-dir="],
    ["--reset=yes"],
    ["--port=47001", "--port=47002"],
    ["--port=3013"],
    ["--sync-port=3010"],
    ["--bilibili-port=5679"],
    ["--align-port=3012"],
    ["--data-dir", "/fixture/other", "--reset"],
  ])("拒绝含糊或危险的参数%j", (...args) => {
    expect(() => parse(args)).toThrow();
  });
  it("保留显式默认reset，单纯解析不执行清理", () => {
    expect(parse(["--reset"])).toMatchObject({ reset: true });
  });
});

describe("真实CLI的启动边界（仅替换子进程边界）", () => {
  it("help不启动服务或打印签名密钥", () => {
    const result = launch(["--help"]);
    expect(result.status).toBe(0);
    expect(result.children).toEqual([]);
    expect(result.stdout).not.toContain("[captured-delete]");
    expect(result.stdout).toContain("--data-dir");
    expect(result.stdout).not.toMatch(/JWT_SECRET|[a-f0-9]{64}/);
  });
  it("未知参数启动前失败，不创建后台服务", () => {
    const result = launch(["--unknown"]);
    expect(result.status).toBe(1);
    expect(result.children).toEqual([]);
    expect(result.stderr).toContain("未知参数");
  });
  it("自定义reset拒绝执行，不触碰其他目录", () => {
    const result = launch(["--data-dir", fixture, "--reset"]);
    expect(result.status).toBe(1);
    expect(result.children).toEqual([]);
    expect(result.stderr).toContain("--reset 不与 --data-dir 同用");
  });
  it("所选端口、loopback、数据路径传给原服务，进程组独立", async () => {
    const [port, bilibiliPort, syncPort, alignPort] = await freePorts(4);
    const data = join(fixture, "isolated data");
    const result = launch([
      "--port",
      String(port),
      "--bilibili-port",
      String(bilibiliPort),
      "--sync-port",
      String(syncPort),
      "--align-port",
      String(alignPort),
      "--data-dir",
      data,
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.children).toHaveLength(4);
    const [bilibili, sync, align, web] = result.children;
    const upstream = `http://127.0.0.1:${bilibiliPort}`;
    expect(bilibili.env).toMatchObject({ PORT: String(bilibiliPort) });
    expect(sync.env).toMatchObject({
      PORT: String(syncPort),
      DATA_DIR: join(data, "sync-data"),
      BIU_SANDBOX_UPSTREAM_ORIGIN: upstream,
    });
    expect(align.env).toMatchObject({
      PORT: String(alignPort),
      DATA_DIR: join(data, "align-data"),
      WORK_DIR: join(data, "align-work"),
    });
    expect(align.args).toEqual(["pnpm", "exec", "tsx", "src/index.ts", "--mock"]);
    expect(web.args).toEqual(["pnpm", "exec", "rsbuild", "dev", "--host", "127.0.0.1", "--port", String(port)]);
    expect(web.env).toMatchObject({
      BIU_TARGET: "sandbox",
      BIU_SANDBOX_UPSTREAM_ORIGIN: upstream,
      BIU_SYNC_INTERNAL_ORIGIN: `http://127.0.0.1:${syncPort}`,
      BIU_ALIGN_INTERNAL_ORIGIN: `http://127.0.0.1:${alignPort}`,
    });
    for (const child of result.children) expect(child.detached).toBe(process.platform !== "win32");
    expect(result.stdout).toContain(`http://127.0.0.1:${port}`);
  });
  it.skipIf(process.platform === "win32")("一个服务退出时按进程组结束其余三个，只发给本次启动的子进程", async () => {
    const [port, bilibiliPort, syncPort, alignPort] = await freePorts(4);
    const result = launch(
      [
        "--port",
        String(port),
        "--bilibili-port",
        String(bilibiliPort),
        "--sync-port",
        String(syncPort),
        "--align-port",
        String(alignPort),
        "--data-dir",
        join(fixture, "exit data"),
      ],
      { BIU_TEST_EXIT_FIRST: "1" },
    );
    expect(result.status).toBe(1);
    const groups = result.stdout
      .split("\n")
      .filter(line => line.startsWith("[captured-kill-group]"))
      .map(line => JSON.parse(line.slice("[captured-kill-group]".length)));
    expect(groups).toEqual([
      [-70002, "SIGTERM"],
      [-70003, "SIGTERM"],
      [-70004, "SIGTERM"],
    ]);
    expect(result.stdout).not.toContain("[captured-kill-child]");
  });
  it.each(["--port", "--bilibili-port", "--sync-port", "--align-port"])(
    "%s 占用时启动前失败，不换端口冒充新来源",
    async blockedFlag => {
      const blocker = createServer();
      await new Promise<void>(done => blocker.listen(0, "127.0.0.1", done));
      try {
        const address = blocker.address();
        if (!address || typeof address === "string") throw new Error("缺少本地端口");
        const flags = ["--port", "--bilibili-port", "--sync-port", "--align-port"];
        const free = await freePorts(4);
        const args = flags.flatMap((flag, index) => [flag, String(flag === blockedFlag ? address.port : free[index])]);
        const result = launch(args);
        expect(result.status).toBe(1);
        expect(result.children).toEqual([]);
        expect(result.stderr).toContain(`沙箱端口 ${address.port} 暂不可用`);
      } finally {
        await new Promise<void>((done, reject) => blocker.close(error => (error ? reject(error) : done())));
      }
    },
  );
});
