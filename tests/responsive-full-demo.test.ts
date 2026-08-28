import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd());
const prototypeDir = path.join(root, "docs/responsive-prototype");

describe("真实 React 响应式离线 Demo", () => {
  it("入口指向真实 React bundle，而不是手写静态页面", async () => {
    const html = await readFile(path.join(prototypeDir, "full-demo.html"), "utf8");
    const docs = await readFile(path.join(prototypeDir, "FULL-DEMO.md"), "utf8");
    const buildScript = await readFile(path.join(root, "scripts/build-responsive-demo.mjs"), "utf8");

    expect(html).toContain("./runtime/index.html");
    expect(html).toContain("pnpm build:responsive-demo");
    expect(docs).toContain("真实 React 路由树");
    expect(docs).toContain("本地 fixture");
    expect(buildScript).toContain('BIU_TARGET: "demo"');
  });

  it("Demo 的数据适配器只返回本地 fixture，并禁止真实同步通道", async () => {
    const [fixture, request, sync, docs] = await Promise.all([
      readFile(path.join(root, "src/common/offline-demo-fixtures.ts"), "utf8"),
      readFile(path.join(root, "src/service/request/index.ts"), "utf8"),
      readFile(path.join(root, "src/service/sync/index.ts"), "utf8"),
      readFile(path.join(prototypeDir, "FULL-DEMO.md"), "utf8"),
    ]);
    const source = `${fixture}\n${request}\n${sync}`;

    expect(source).toContain("offlineDemoResponse");
    expect(source).toContain("if (isOfflineDemo) return;");
    expect(source).not.toMatch(/fetch\s*\(/u);
    expect(source).not.toMatch(/WebSocket\s*\(/u);
    expect(docs).toContain("不登录");
    expect(docs).toContain("不访问 Bilibili");
  });
});
