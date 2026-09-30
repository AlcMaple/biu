import { describe, expect, it } from "vitest";

import { getBassEnergy, getStageProgress } from "@/components/fancy-full-screen-player/stage-signal";
describe("cinematic stage signals", () => {
  it("clamps seeking and handles missing or invalid duration", () => {
    expect(getStageProgress(50, 100)).toBe(0.5);
    expect(getStageProgress(-5, 100)).toBe(0);
    expect(getStageProgress(110, 100)).toBe(1);
    expect(getStageProgress(10, 0)).toBe(0);
    expect(getStageProgress(Infinity, 100)).toBe(0);
    expect(getStageProgress(10, NaN)).toBe(0);
  });
  it("does not invent energy for silence or an unavailable analyser", () => {
    expect(getBassEnergy(new Uint8Array(256))).toBe(0);
    expect(getBassEnergy(new Uint8Array(0))).toBe(0);
    expect(getBassEnergy(new Uint8Array([255]))).toBe(0);
  });
  it("responds to low frequencies and ignores DC and high-frequency-only input", () => {
    const bins = new Uint8Array(256);
    bins[0] = 255;
    bins.fill(255, 18);
    expect(getBassEnergy(bins)).toBe(0);
    bins.fill(255, 1, 18);
    expect(getBassEnergy(bins)).toBe(1);
    bins.fill(128, 1, 18);
    expect(getBassEnergy(bins)).toBeCloseTo(128 / 255);
  });
});
