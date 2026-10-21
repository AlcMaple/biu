// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createProviderClient } from "@shared/lyrics-provider-guard";
import { parseRetryAfter, type ProviderTransport } from "@shared/lyrics-providers";

const AMLL_OK = JSON.stringify({
  status: 200,
  data: { items: [{ id: 1, musicNames: ["晴天"], artistNames: ["周杰伦"] }] },
});

function setup(respond: () => { status: number; text: string; retryAfter?: string }, requestsPerMinute?: number) {
  let time = 1_000_000;
  const transport = vi.fn<ProviderTransport>(async () => respond());
  const client = createProviderClient({ now: () => time, requestsPerMinute });
  return { client, transport, advance: (ms: number) => (time += ms) };
}

describe("歌词渠道请求保护", () => {
  it("相同搜索在有效期内走缓存，不再请求上游", async () => {
    const { client, transport, advance } = setup(() => ({ status: 200, text: AMLL_OK }));
    const first = await client.search(transport, { provider: "amll", title: "晴天" });
    const second = await client.search(transport, { provider: "amll", title: " 晴天 " });
    expect(first).toEqual(second);
    expect(transport).toHaveBeenCalledTimes(1);

    advance(31 * 60_000);
    await client.search(transport, { provider: "amll", title: "晴天" });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("同时发起的相同请求合并成一次", async () => {
    const { client, transport } = setup(() => ({ status: 200, text: AMLL_OK }));
    await Promise.all([
      client.search(transport, { provider: "amll", title: "晴天" }),
      client.search(transport, { provider: "amll", title: "晴天" }),
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("被限流后按 Retry-After 冷却：期间不碰上游，到点后由用户再点才会发", async () => {
    let status = 429;
    const { client, transport, advance } = setup(() => ({ status, text: "", retryAfter: "120" }));
    const limited = await client.search(transport, { provider: "qq", title: "晴天" });
    expect(limited).toMatchObject({ ok: false, error: { kind: "rate_limited", retryAfterMs: 120_000 } });

    advance(30_000);
    const blocked = await client.search(transport, { provider: "qq", title: "别的歌" });
    expect(blocked).toMatchObject({ ok: false, error: { kind: "rate_limited", retryAfterMs: 90_000 } });
    expect(transport).toHaveBeenCalledTimes(1);

    // 其他渠道不受影响
    status = 200;
    await client.search(transport, { provider: "amll", title: "晴天" });
    expect(transport).toHaveBeenCalledTimes(2);

    advance(91_000);
    status = 200;
    await client.search(transport, { provider: "qq", title: "别的歌" });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("没给 Retry-After 时限流冷却 1 分钟，服务异常 30 秒，失败结果不进缓存", async () => {
    const { client, transport, advance } = setup(() => ({ status: 503, text: "" }));
    const failed = await client.search(transport, { provider: "kugou", title: "晴天" });
    expect(failed).toMatchObject({ ok: false, error: { kind: "upstream", retryAfterMs: 30_000 } });
    advance(30_001);
    await client.search(transport, { provider: "kugou", title: "晴天" });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("每分钟请求数超过预算时本地拦下，并告诉用户还要等多久", async () => {
    const { client, transport, advance } = setup(() => ({ status: 200, text: AMLL_OK }), 2);
    await client.search(transport, { provider: "amll", title: "a" });
    advance(10_000);
    await client.search(transport, { provider: "amll", title: "b" });
    const third = await client.search(transport, { provider: "amll", title: "c" });
    expect(third).toMatchObject({ ok: false, error: { kind: "rate_limited", retryAfterMs: 50_000 } });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("返回的是副本，调用方改了也不会污染缓存", async () => {
    const { client, transport } = setup(() => ({ status: 200, text: AMLL_OK }));
    const first = await client.search(transport, { provider: "amll", title: "晴天" });
    if (first.ok) first.data[0].title = "改过";
    const second = await client.search(transport, { provider: "amll", title: "晴天" });
    expect(second.ok && second.data[0].title).toBe("晴天");
  });
});

it("parseRetryAfter 支持秒数和 HTTP 日期", () => {
  expect(parseRetryAfter("5")).toBe(5000);
  expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT", Date.parse("Wed, 21 Oct 2026 07:27:00 GMT"))).toBe(60_000);
  expect(parseRetryAfter("bogus")).toBeUndefined();
});
