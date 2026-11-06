import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function parseSandboxOptions(args, cwd = process.cwd(), home = homedir()) {
  const options = { port: 5679, alignPort: 3013, dataRoot: join(home, ".biu-sandbox"), reset: false, help: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const [flag, ...inline] = args[index].split("=");
    if (seen.has(flag)) throw new Error(`重复参数：${flag}`);
    seen.add(flag);
    if (flag === "--reset" || flag === "--help" || flag === "-h") {
      if (inline.length) throw new Error(`${flag} 不接受参数值`);
      options[flag === "--reset" ? "reset" : "help"] = true;
      continue;
    }
    if (!["--port", "--align-port", "--data-dir"].includes(flag)) throw new Error(`未知参数：${flag}`);
    const value = inline.length ? inline.join("=") : args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} 需要参数值`);
    if (flag === "--data-dir") {
      options.dataRoot = resolve(cwd, value);
    } else {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
        throw new Error(`${flag} 需要 1–65535 的整数端口`);
      }
      options[flag === "--port" ? "port" : "alignPort"] = Number(value);
    }
  }
  if (options.port === options.alignPort) throw new Error("Web 与对齐服务需要不同端口");
  // 自定义目录可能含其他用途的文件，不让一个新增路径参数扩大旧清理命令的删除范围。
  if (options.reset && seen.has("--data-dir")) throw new Error("--reset 不与 --data-dir 同用；请换用新的专用沙箱目录");
  return options;
}

export async function checkSandboxPorts(options) {
  for (const port of [options.port, options.alignPort]) {
    await new Promise((done, reject) => {
      const server = createServer();
      server.once("error", error => {
        reject(new Error(`沙箱端口 ${port} 暂不可用（${error.code ?? "监听失败"}），未启动子进程`));
      });
      server.listen(port, "127.0.0.1", () => server.close(error => (error ? reject(error) : done())));
    });
  }
}

export const sandboxWebOrigin = port => `http://${port === 5679 ? "localhost" : "127.0.0.1"}:${port}`;

export const sandboxHelp = `Biu 本地沙箱
用法：pnpm sandbox [--port <Web端口>] [--align-port <对齐端口>] [--data-dir <服务数据目录>]
默认：Web 5679；对齐服务 3013；数据 ~/.biu-sandbox；仅监听 127.0.0.1
--help, -h  显示帮助，不启动服务
--reset     清空默认沙箱的对齐数据，不与 --data-dir 同用
同一角色续用原 Web 端口和数据目录；全新会话使用新的 Web 端口。
端口隔离浏览器本地存储，数据目录隔离 mock 对齐服务数据。
同主机不同端口仍共享 Cookie；独立身份用不同 localhost 主机名或浏览器 profile，不等于生产账号隔离。`;
