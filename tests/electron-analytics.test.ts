// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock("electron-is-dev", () => ({ default: false }));
vi.mock("electron-log", () => ({ default: analyticsMocks }));
vi.mock("electron", () => ({ app: { getVersion: () => "2.5.4" } }));

describe("Electron activity analytics", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports anonymous desktop activity through Umami and coalesces concurrent focus events", async () => {
    let resolveResponse!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>(resolve => {
          resolveResponse = resolve;
        }),
    );
    globalThis.fetch = fetch as typeof globalThis.fetch;

    const { reportDesktopActivity } = await import("../electron/analytics");
    const startup = reportDesktopActivity("startup");
    const focus = reportDesktopActivity("focus");

    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://user.alcmaple.cn/api/send");
    expect(options).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "application/json",
        "User-Agent": expect.stringMatching(/^Mozilla\/5\.0/),
        "x-umami-hostname": "biu-desktop",
        "x-umami-website-id": "4a1ac5d8-22f8-481b-9084-c9282e0c3ce5",
      }),
    });
    expect(options.headers).not.toHaveProperty("Authorization");

    const body = JSON.parse(String(options.body)) as {
      payload: { data: Record<string, string>; name: string; url: string; website: string };
      type: string;
    };
    expect(body).toMatchObject({
      type: "event",
      payload: {
        hostname: "biu-desktop",
        language: "zh-CN",
        name: "desktop_active",
        title: "Biu Desktop",
        url: "/desktop",
        website: "4a1ac5d8-22f8-481b-9084-c9282e0c3ce5",
      },
    });
    expect(body.payload.data).toMatchObject({
      appVersion: expect.any(String),
      arch: process.arch,
      platform: process.platform,
      reason: "startup",
    });

    resolveResponse(new Response(JSON.stringify({ cache: "cache-token" }), { status: 200 }));
    await Promise.all([startup, focus]);
    await reportDesktopActivity("activate");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("swallows an Umami failure and records a warning without rejecting startup", async () => {
    const error = new Error("analytics offline");
    const fetch = vi.fn().mockRejectedValue(error);
    globalThis.fetch = fetch as typeof globalThis.fetch;

    const { reportDesktopActivity } = await import("../electron/analytics");
    await expect(reportDesktopActivity("startup")).resolves.toBeUndefined();

    expect(analyticsMocks.warn).toHaveBeenCalledWith("[analytics] Umami 活跃数据上报失败", error);
  });

  it("does not send development activity to the production dashboard", async () => {
    vi.doMock("electron-is-dev", () => ({ default: true }));
    const fetch = vi.fn();
    globalThis.fetch = fetch as typeof globalThis.fetch;

    const { reportDesktopActivity } = await import("../electron/analytics");
    await reportDesktopActivity("startup");

    expect(fetch).not.toHaveBeenCalled();
  });
});
