import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@heroui/react", () => ({
  addToast: vi.fn(),
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- preserves the mocked library API
  useDisclosure: () => ({ isOpen: false, onOpen: vi.fn(), onClose: vi.fn(), onOpenChange: vi.fn() }),
}));
vi.mock("@/store/play-list", () => ({
  usePlayList: Object.assign((selector: (state: { playId: string }) => unknown) => selector({ playId: "fixture" }), {
    getState: () => ({ getPlayItem: () => undefined }),
  }),
}));
vi.mock("@/platform", () => ({ default: { getStore: vi.fn(), setStore: vi.fn() } }));
vi.mock("@/components/lyrics-search-modal", () => ({ default: () => null }));
vi.mock("@/components/icon-button", () => ({ default: () => null }));
vi.mock("@/components/lyrics/font-size-control", () => ({ default: () => null }));
vi.mock("@/components/lyrics/offset-control", () => ({ default: () => null }));

import Lyrics from "@/components/lyrics";
import { useLyricsState } from "@/store/lyrics-state";
import { usePlayProgress } from "@/store/play-progress";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Element.prototype.scrollTo = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  useLyricsState.getState().setLyrics([
    { time: 0, text: "第一句歌词" },
    { time: 5000, text: "ThisLongUnbrokenLineMustKeepItsSizeWhenHighlighted" },
    { time: 10000, text: "第三句歌词" },
  ]);
  usePlayProgress.setState({ currentTime: 1 });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("moves the sole lyric focus without changing font size or weight", async () => {
  await act(async () => root.render(<Lyrics stableTypography color="#ffffff" />));
  const lines = [...host.querySelectorAll<HTMLElement>("[data-lyric-state]")];
  const sizes = lines.map(line => line.style.fontSize);
  const weights = lines.map(line => line.firstElementChild?.className);
  expect(host.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  expect(lines[0].dataset.lyricState).toBe("active");
  await act(async () => usePlayProgress.setState({ currentTime: 6 }));
  expect(lines[0].dataset.lyricState).toBe("past");
  expect(lines[1].dataset.lyricState).toBe("active");
  expect(lines[2].dataset.lyricState).toBe("upcoming");
  expect(host.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  expect(lines.map(line => line.style.fontSize)).toEqual(sizes);
  expect(lines.map(line => line.firstElementChild?.className)).toEqual(weights);
  expect((lines[1].firstElementChild as HTMLElement).style.color).toBe("");
});

it("preserves ordinary player color and enlarged active lyrics", async () => {
  await act(async () => root.render(<Lyrics color="#ffffff" />));
  const lines = [...host.querySelectorAll<HTMLElement>("[data-lyric-state]")];
  expect(lines[0].style.fontSize).toBe("30px");
  expect(lines[1].style.fontSize).toBe("20px");
  expect((lines[0].firstElementChild as HTMLElement).style.color).toBe("rgb(255, 255, 255)");
  expect(host.querySelector(".fancy-lyric-line")).toBeNull();
});
