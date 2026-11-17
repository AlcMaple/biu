import type { RsbuildPluginAPI } from "@rsbuild/core";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ loaded: [] as string[], events: [] as string[] }));
vi.mock("@rsbuild/core", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("rimraf", () => ({ rimrafSync: () => h.events.push("clean") }));

beforeEach(() => {
  vi.resetModules();
  h.loaded.length = 0;
  h.events.length = 0;
  vi.doMock("../plugins/electron-dev", () => {
    h.loaded.push("dev");
    return { startElectronDev: () => h.events.push("start") };
  });
  vi.doMock("../plugins/electron-config-build", () => {
    h.loaded.push("config");
    return {
      buildElectronConfig: async (mode?: string) => {
        h.events.push(`config:${mode ?? "production"}`);
      },
    };
  });
  vi.doMock("../plugins/electron-build", () => {
    h.loaded.push("build");
    return {
      buildElectron: async () => {
        h.events.push("package");
      },
    };
  });
});
afterEach(() => vi.unstubAllEnvs());

async function load(target: string) {
  vi.stubEnv("BIU_TARGET", target);
  const hooks: {
    dev?: (options: { isFirstCompile: boolean }) => Promise<void>;
    before?: () => Promise<void>;
    after?: () => Promise<void>;
  } = {};
  const { pluginElectron } = await import("../plugins/rsbuild-plugin-electron");
  pluginElectron().setup({
    onAfterDevCompile: (fn: typeof hooks.dev) => {
      hooks.dev = fn;
    },
    onBeforeBuild: (fn: typeof hooks.before) => {
      hooks.before = fn;
    },
    onAfterBuild: (fn: typeof hooks.after) => {
      hooks.after = fn;
    },
  } as unknown as RsbuildPluginAPI);
  return hooks;
}

describe("按目标加载Electron工具", () => {
  it.each(["web", "demo", "sandbox"])("%s解析配置和执行钩子都不加载Electron工具", async target => {
    const hooks = await load(target);
    expect(h.loaded).toEqual([]);
    await hooks.dev?.({ isFirstCompile: true });
    await hooks.before?.();
    await hooks.after?.();
    expect(h.loaded).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it("桌面首次编译按原顺序先编译主进程再启动，后续编译不重复启动", async () => {
    const hooks = await load("");
    expect(h.loaded).toEqual([]);
    await hooks.dev?.({ isFirstCompile: false });
    expect(h.loaded).toEqual([]);
    await hooks.dev?.({ isFirstCompile: true });
    expect(h.events).toEqual(["config:development", "start"]);
    expect(h.loaded).not.toContain("build");
  });

  it("桌面构建保留清理、编译和打包，不加载开发启动器", async () => {
    const hooks = await load("");
    await hooks.before?.();
    await hooks.after?.();
    expect(h.events).toEqual(["clean", "config:production", "package"]);
    expect(h.loaded).not.toContain("dev");
  });
});
