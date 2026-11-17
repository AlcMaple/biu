import type { RequestHandler } from "@rsbuild/core";

import { SANDBOX_CONTROL_ROOT } from "../shared/sandbox";

// 本地沙盒的 dev 中间件（只在 BIU_TARGET=sandbox 时挂载，由 scripts/sandbox.mjs 启动）：
// 把页面里沙盒菜单的两种操作转给本机假 B 站的控制面。只认这两条固定路径、固定目标，不是通用代理
const ROUTES: Record<string, string[]> = {
  approve: ["POST"],
  state: ["GET", "POST"],
};

export function createSandboxMiddleware(): RequestHandler {
  const origin = process.env.BIU_SANDBOX_UPSTREAM_ORIGIN;
  if (!origin) throw new Error("沙盒要用 `pnpm sandbox` 启动：它会一起起假 B 站、同步和对齐服务");

  return (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://sandbox.local");
    if (!url.pathname.startsWith(`${SANDBOX_CONTROL_ROOT}/`)) return next();
    const name = url.pathname.slice(SANDBOX_CONTROL_ROOT.length + 1);
    const method = request.method ?? "GET";
    if (!ROUTES[name]?.includes(method)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const upstream = await fetch(new URL(`/__sandbox/${name}`, origin), {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? Buffer.concat(chunks) : undefined,
      });
      response.statusCode = upstream.status;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(Buffer.from(await upstream.arrayBuffer()));
    })().catch(error => {
      response.statusCode = 502;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ ok: false, message: `连不上本机假 B 站：${String(error)}` }));
    });
  };
}
