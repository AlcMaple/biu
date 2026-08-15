import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import postcssScopeDataHover, {
  containsDataHoverAttribute,
  scopeDataHoverSelectorList,
} from "../plugins/postcss-scope-data-hover";

const rootMocks = vi.hoisted(() => ({
  createRoot: vi.fn(),
  render: vi.fn(),
}));

vi.mock("react-dom/client", () => ({ createRoot: rootMocks.createRoot }));
vi.mock("@/app", () => ({ App: () => null }));

describe("Web hover CSS gates", () => {
  it("recognizes real HeroUI hover attributes without mistaking escaped class text or the root gate", () => {
    expect(containsDataHoverAttribute(".button[data-hover=true]")).toBe(true);
    expect(containsDataHoverAttribute(".radio[data-hover-unselected=true]")).toBe(true);
    expect(containsDataHoverAttribute(String.raw`.class\[data-hover\=true\]`)).toBe(false);
    expect(containsDataHoverAttribute(':root[data-hover-effects="enabled"] .button')).toBe(false);
  });

  it("gates only hover branches in comma-separated selectors and preserves nested commas", () => {
    const selector = '.plain, :is(.first, .second)[data-hover="true"], .last[data-selected=true]';

    expect(scopeDataHoverSelectorList(selector)).toBe(
      '.plain, :where(:root[data-hover-effects="enabled"]) :is(.first, .second)[data-hover="true"], .last[data-selected=true]',
    );
  });

  it("exposes a PostCSS rule visitor and keeps already gated selectors idempotent", () => {
    const rule = {
      selector: '.button[data-hover=true], :where(:root[data-hover-effects="enabled"]) .item[data-hover=true]',
    };

    postcssScopeDataHover.Rule(rule);

    expect(rule.selector).toBe(
      ':where(:root[data-hover-effects="enabled"]) .button[data-hover=true], :where(:root[data-hover-effects="enabled"]) .item[data-hover=true]',
    );
  });

  it("defines a Tailwind hover variant that also compounds into group-hover and dark:hover", async () => {
    const css = await readFile(path.resolve(process.cwd(), "src/app.css"), "utf8");

    expect(css).toContain("@media (hover: hover)");
    expect(css).toContain('&:where([data-hover-effects="enabled"] *):hover');
    expect(css).toContain("@slot");
    expect(css).toContain("--os-handle-bg-hover: var(--os-handle-bg);");
    expect(css).toContain(':root[data-hover-effects="enabled"] .os-scrollbar');
  });
});

describe("hover platform marker", () => {
  const originalUserAgent = navigator.userAgent;
  const originalCapacitor = Reflect.get(globalThis, "Capacitor");

  const setRuntime = (userAgent: string, platform?: "android", native = false) => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
    if (platform) {
      Reflect.set(globalThis, "Capacitor", {
        getPlatform: () => platform,
        isNativePlatform: () => native,
      });
    } else {
      Reflect.deleteProperty(globalThis, "Capacitor");
    }
  };

  beforeEach(() => {
    vi.resetModules();
    document.documentElement.removeAttribute("data-hover-effects");
    document.body.innerHTML = '<div id="root"></div>';
    rootMocks.createRoot.mockReset();
    rootMocks.render.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalUserAgent });
    if (originalCapacitor === undefined) Reflect.deleteProperty(globalThis, "Capacitor");
    else Reflect.set(globalThis, "Capacitor", originalCapacitor);
  });

  it.each([
    { expectedMarker: undefined, label: "ordinary Web", userAgent: "Mozilla/5.0 Chrome/140.0.0.0" },
    { expectedMarker: "enabled", label: "Electron", userAgent: "Mozilla/5.0 Electron/38.6.0" },
    {
      expectedMarker: "enabled",
      label: "native Android",
      native: true,
      platform: "android" as const,
      userAgent: "Mozilla/5.0 Linux; Android 16",
    },
  ])("sets the root marker before React for $label", async ({ expectedMarker, native, platform, userAgent }) => {
    const markerAtCreateRoot: Array<string | undefined> = [];
    setRuntime(userAgent, platform, native);
    rootMocks.createRoot.mockImplementation(() => {
      markerAtCreateRoot.push(document.documentElement.dataset.hoverEffects);
      return { render: rootMocks.render };
    });

    await import("@/index");

    expect(markerAtCreateRoot).toEqual([expectedMarker]);
    expect(document.documentElement.dataset.hoverEffects).toBe(expectedMarker);
  });
});
