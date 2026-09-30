import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const signal = vi.hoisted(() => ({ time: 0, duration: 100, amplitude: 0 }));
const readSpectrum = vi.hoisted(() => vi.fn((bins: Uint8Array) => bins.fill(signal.amplitude)));
const getAnalyser = vi.hoisted(() => vi.fn());
vi.mock("@/platform", () => ({ isElectron: true }));
vi.mock("@/common/utils/audio-graph", () => ({ getAnalyser, resumeAudioGraph: vi.fn() }));
vi.mock("@/store/play-list", () => ({ usePlayList: { getState: () => ({ duration: signal.duration }) } }));
vi.mock("@/store/play-progress", () => ({ usePlayProgress: { getState: () => ({ currentTime: signal.time }) } }));

import CinematicStage from "@/components/fancy-full-screen-player/cinematic-stage";

let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let media: {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
let disconnect: ReturnType<typeof vi.fn>;
let mediaChange: () => void;
let id: number;
const tick = async (time: number) => {
  const callbacks = [...frames.values()];
  frames.clear();
  await act(async () => callbacks.forEach(callback => callback(time)));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  signal.time = 0;
  signal.amplitude = 0;
  id = 0;
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame));
  media = {
    matches: false,
    addEventListener: vi.fn((_event, callback) => {
      mediaChange = callback;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => media);
  disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect = disconnect;
    },
  );
  const noop = () => {};
  const context = {
    setTransform: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    fill: noop,
    arc: noop,
    stroke: noop,
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  getAnalyser.mockReturnValue({ frequencyBinCount: 256, getByteFrequencyData: readSpectrum });
  host = document.createElement("div");
  host.className = "fancy-player";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("uses spectrum energy and playback progress while keeping a single animation loop", async () => {
  await act(async () => root.render(<CinematicStage running />));
  await tick(100);
  expect(host.style.getPropertyValue("--stage-energy")).toBe("0.000");
  signal.amplitude = 255;
  signal.time = 50;
  await tick(140);
  expect(Number(host.style.getPropertyValue("--stage-energy"))).toBeGreaterThan(0);
  expect(host.style.getPropertyValue("--stage-hue")).toBe("205.0deg");
  expect(frames.size).toBe(1);
  expect(getAnalyser).toHaveBeenCalledTimes(1);
});

it("stops sampling on pause and releases animation resources when closed", async () => {
  await act(async () => root.render(<CinematicStage running />));
  await tick(100);
  await act(async () => root.render(<CinematicStage running={false} />));
  readSpectrum.mockClear();
  await tick(140);
  expect(readSpectrum).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  await act(async () => root.render(null));
  expect(frames.size).toBe(0);
  expect(disconnect).toHaveBeenCalled();
  expect(media.removeEventListener).toHaveBeenCalled();
});

it("renders once for reduced motion, then resumes only when the preference changes", async () => {
  media.matches = true;
  await act(async () => root.render(<CinematicStage running />));
  await tick(100);
  expect(getAnalyser).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  media.matches = false;
  await act(async () => mediaChange());
  await tick(140);
  expect(getAnalyser).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(1);
});
