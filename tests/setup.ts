import { vi } from "vitest";

import "@testing-library/jest-dom";

class FakeMediaSession {
  metadata: any;
  playbackState: string = "none";
  setActionHandler() {}
  setPositionState() {}
}

class FakeMediaMetadata {
  constructor(public data: any) {}
}

class FakeAudio {
  preload: string = "none";
  controls: boolean = false;
  crossOrigin: string = "anonymous";
  volume: number = 1;
  muted: boolean = false;
  playbackRate: number = 1;
  loop: boolean = false;
  src: string = "";
  currentSrc: string = "";
  currentTime: number = 0;
  duration: number = 0;
  readyState: number = 0;
  networkState: number = 0;
  buffered: { length: number; end: (i: number) => number } = { length: 0, end: () => 0 };
  paused: boolean = true;
  ondurationchange?: () => void;
  ontimeupdate?: () => void;
  onseeked?: () => void;
  onratechange?: () => void;
  onplay?: () => void;
  onpause?: () => void;
  onended?: () => void;
  onerror?: (err: any) => void;
  onwaiting?: () => void;
  onstalled?: () => void;
  onplaying?: () => void;
  error: { code: number; message?: string } | null = null;
  private listeners = new Map<string, Set<(event: any) => void>>();
  getAttribute(name: string) {
    return name === "src" ? this.src || null : null;
  }
  addEventListener(type: string, listener: (event: any) => void) {
    const bucket = this.listeners.get(type) ?? new Set();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }
  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatchEvent(event: { type: string }) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }
  load() {
    this.duration = 123;
    if (typeof this.ondurationchange === "function") this.ondurationchange();
  }
  async play() {
    this.paused = false;
    if (typeof this.onplay === "function") this.onplay();
    if (typeof this.ontimeupdate === "function") this.ontimeupdate();
  }
  pause() {
    this.paused = true;
    if (typeof this.onpause === "function") this.onpause();
  }
}

const g: any = globalThis;
const nav: any = g.navigator ?? {};
if (!nav.mediaSession) {
  nav.mediaSession = new FakeMediaSession();
}
if (typeof g.navigator === "undefined") {
  Object.defineProperty(g, "navigator", { value: nav, configurable: true });
}
g.MediaMetadata = FakeMediaMetadata;
g.window = g;
if (typeof g.window.addEventListener !== "function") {
  g.window.addEventListener = () => {};
}
if (typeof g.window.removeEventListener !== "function") {
  g.window.removeEventListener = () => {};
}
g.window.electron = undefined;
g.Audio = FakeAudio as any;
if (typeof g.MediaError === "undefined") {
  g.MediaError = { MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 };
}

vi.mock("electron-log/renderer", () => {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    log: vi.fn(),
  };
  return { default: logger };
});
