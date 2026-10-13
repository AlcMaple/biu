// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createMediaPacer, resolveMediaRate } from "../web-server/media-pacer";

const KB = 1024;

describe("Web 媒体限速", () => {
  it("按码率两倍发送，并受上限约束", () => {
    expect(resolveMediaRate(192_000, 160 * KB)).toBe(48 * KB);
    expect(resolveMediaRate(320_000, 160 * KB)).toBe(80_000);
    expect(resolveMediaRate(1_000_000, 160 * KB)).toBe(160 * KB);
  });

  it("上限低于实时码率时仍保留 1.25 倍实时，不让播放断粮", () => {
    expect(resolveMediaRate(3_000_000, 160 * KB)).toBe(Math.round((3_000_000 / 8) * 1.25));
  });

  it("不知道码率时用上限，不猜低值", () => {
    expect(resolveMediaRate(undefined, 160 * KB)).toBe(160 * KB);
  });

  it("突发额度内直接放行，超出后按速率延后", async () => {
    let now = 0;
    const pacer = createMediaPacer(1000, () => now);
    const chunks: number[] = [];
    pacer.on("data", (chunk: Buffer) => chunks.push(chunk.length));

    pacer.write(Buffer.alloc(15_000));
    await new Promise(resolve => setImmediate(resolve));
    expect(chunks).toEqual([15_000]);

    pacer.write(Buffer.alloc(50));
    await new Promise(resolve => setImmediate(resolve));
    expect(chunks).toEqual([15_000]);

    now = 50;
    await new Promise(resolve => setTimeout(resolve, 70));
    expect(chunks).toEqual([15_000, 50]);
  });
});
