import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@capacitor/core", () => ({ CapacitorHttp: { request: mocks.request } }));

import { nativeGetProviderLyrics, nativeSearchProviderLyrics } from "@/platform/lyrics-native";

beforeEach(() => {
  mocks.request.mockReset();
});

it("手机 App 走原生 HTTP：要原始文本、不跟随重定向，带上渠道需要的请求头", async () => {
  mocks.request.mockResolvedValue({
    status: 200,
    headers: {},
    data: '{"status":200,"data":{"items":[{"id":7192686136682066,"musicNames":["晴天"],"artistNames":["周杰伦"]}]}}',
  });
  const result = await nativeSearchProviderLyrics({ provider: "amll", title: "晴天" });

  expect(result).toMatchObject({ ok: true, data: [{ id: "7192686136682066", title: "晴天" }] });
  expect(mocks.request).toHaveBeenCalledWith(
    expect.objectContaining({
      url: "https://api.amll.dev/v1/lyrics/search?musicName=%E6%99%B4%E5%A4%A9&pageSize=20",
      method: "GET",
      responseType: "text",
      disableRedirects: true,
    }),
  );
});

it("限流时读 Retry-After（不区分大小写），冷却期内不再发请求", async () => {
  mocks.request.mockResolvedValue({ status: 429, headers: { "Retry-After": "90" }, data: "" });
  const first = await nativeGetProviderLyrics({ provider: "qq", id: "0039MnYb0qxYhV" });
  const second = await nativeGetProviderLyrics({ provider: "qq", id: "0039MnYb0qxYhV" });

  expect(first).toMatchObject({ ok: false, error: { kind: "rate_limited", retryAfterMs: 90_000 } });
  expect(second).toMatchObject({ ok: false, error: { kind: "rate_limited" } });
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it("原生层超时如实报成超时", async () => {
  mocks.request.mockImplementation(async () => {
    throw new Error("The request timed out.");
  });
  const result = await nativeSearchProviderLyrics({ provider: "kugou", title: "晴天" });
  expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
});
