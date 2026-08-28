import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile viewport height chain", () => {
  it("binds Theme directly to the measured visible height instead of an auto-height provider wrapper", async () => {
    const source = await readFile(path.resolve(process.cwd(), "src/components/theme/index.tsx"), "utf8");

    expect(source).toContain('<main className="h-[var(--app-h,100dvh)] w-full overflow-hidden">');
    expect(source).not.toContain('<main className="h-screen w-screen overflow-hidden">');
    expect(source).not.toContain('<main className="h-full w-full overflow-hidden">');
  });

  it("leaves the document root available for native pull-to-refresh", async () => {
    const source = await readFile(path.resolve(process.cwd(), "src/app.css"), "utf8");

    expect(source).toContain("html,\nbody {");
    expect(source).toContain("#root {");
    expect(source).toContain("overflow-x: clip;");
    expect(source).not.toContain("html,\nbody,\n#root {");
  });
});
