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

  it("locks the Web document and contains the existing inner scroll viewport", async () => {
    const source = await readFile(path.resolve(process.cwd(), "src/app.css"), "utf8");

    const mobileRules = source.slice(source.indexOf("@media (width <="));
    expect(mobileRules).toContain(':root[data-platform="web"] body');
    expect(mobileRules).toContain(':root[data-platform="web"] #root');
    expect(mobileRules).toContain("position: fixed;");
    expect(mobileRules).toContain("inset: 0;");
    expect(mobileRules).toContain("min-height: 0;");
    expect(mobileRules).toContain("overflow: hidden;");
    expect(mobileRules).toContain("overscroll-behavior-y: none;");
    expect(mobileRules).toContain(':root[data-platform="web"] [data-overlayscrollbars-viewport]');
    expect(mobileRules).toContain("overscroll-behavior-y: contain;");
    expect(mobileRules).not.toContain("touch-action: none");
    expect(mobileRules).not.toContain("100lvh");
  });

  it("reuses the mobile breakpoint and keeps touch devices locked after rotating past it", async () => {
    const [css, responsive] = await Promise.all([
      readFile(path.resolve(process.cwd(), "src/app.css"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/common/hooks/use-responsive.ts"), "utf8"),
    ]);
    const mobileWidth = /const MOBILE_MAX_WIDTH = (\d+);/.exec(responsive)?.[1];

    expect(mobileWidth).toBeDefined();
    expect(css).toContain(`@media (width <= ${mobileWidth}px), (hover: none) and (pointer: coarse)`);
  });

  it("keeps safe areas and a non-scrolling, non-remounting shared layout", async () => {
    const [html, layout] = await Promise.all([
      readFile(path.resolve(process.cwd(), "src/index.html"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/layout/index.tsx"), "utf8"),
    ]);

    expect(html).toContain("viewport-fit=cover");
    expect(layout).toContain("h-[calc(4rem+env(safe-area-inset-top))]");
    expect(layout).toContain("h-[calc(88px+env(safe-area-inset-bottom))]");
    expect(layout.match(/<Outlet\s*\/>/g)).toHaveLength(1);
    expect(layout).toContain('<div className="min-h-0 flex-1 overflow-hidden">');
  });
});
