import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@heroui/react", () => ({
  Button: ({ children, "aria-label": label }: any) => (
    <button type="button" aria-label={label}>
      {children}
    </button>
  ),
  Popover: ({ children }: any) => <>{children}</>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <div data-testid="panel">{children}</div>,
}));
vi.mock("@/common/hooks/use-responsive", () => ({ useIsMobileLayout: () => false }));
vi.mock("@/store/play-list", async () => {
  const { create } = await import("zustand");
  const item = { id: "a", bvid: "BV1za41197Y9", cid: "813345505", title: "背对背拥抱" };
  return {
    usePlayList: create(() => ({ playId: "a", list: [item], getPlayItem: () => item })),
  };
});

import AlignChip from "@/components/lyrics/align-chip";
import { useLyricsAlignSession } from "@/store/lyrics-align-session";
import { useLyricsState } from "@/store/lyrics-state";

const bvid = "BV1za41197Y9";
const cid = "813345505";
const target = { bvid, cid, title: "背对背拥抱", cacheKey: `${bvid}-${cid}` };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  useLyricsState.getState().setLyrics([{ time: 0, text: "话总说不清楚" }]);
  useLyricsAlignSession.setState({ target: null, phase: { kind: "idle" }, hidden: false });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

// 标签本身（不含点开的面板），面板里的说明文字不算标签文案
const text = () => host.querySelector("button")?.textContent ?? null;

it("tells line-estimated lyrics apart from aligned ones", async () => {
  await act(async () => root.render(<AlignChip onSearchLyrics={vi.fn()} onUploadLyrics={vi.fn()} />));
  expect(text()).toContain("未对齐");

  await act(async () =>
    useLyricsState.getState().setLyrics([
      {
        time: 0,
        text: "话总",
        words: [
          { text: "话", time: 0 },
          { text: "总", time: 300 },
        ],
      },
    ]),
  );
  expect(text()).toContain("已对齐");
});

it("歌词平台自带的逐字时间不显示成「已对齐」", async () => {
  await act(async () => root.render(<AlignChip onSearchLyrics={vi.fn()} onUploadLyrics={vi.fn()} />));
  await act(async () =>
    useLyricsState
      .getState()
      .setLyrics([{ time: 0, text: "话总", words: [{ text: "话", time: 0 }], nativeWords: true }]),
  );
  expect(text()).toContain("原唱时间");
  expect(text()).not.toContain("已对齐");
});

it("shows a queued automatic job with its queue position", async () => {
  await act(async () => root.render(<AlignChip onSearchLyrics={vi.fn()} onUploadLyrics={vi.fn()} />));
  await act(async () =>
    useLyricsAlignSession.setState({
      target,
      hidden: true,
      phase: { kind: "working", view: { id: "j", state: "queued", position: 3 } as AlignJobView },
    }),
  );
  expect(text()).toContain("排队");
  expect(text()).toContain("前 3 首");
});

it("shows a failure as a short chip, with the full reason and next step in the panel", async () => {
  await act(async () => root.render(<AlignChip onSearchLyrics={vi.fn()} onUploadLyrics={vi.fn()} />));
  await act(async () =>
    useLyricsAlignSession.setState({
      target,
      hidden: false,
      phase: { kind: "failed", message: "歌词和音频对不上，没法逐字对齐", code: "LYRICS_MISMATCH" },
    }),
  );
  expect(text()).toBe("对齐失败");
  const panel = host.querySelector('[data-testid="panel"]')?.textContent ?? "";
  expect(panel).toContain("歌词和音频对不上，没法逐字对齐");
  expect(panel).toContain("换一份歌词");
});

it("renders nothing without lyrics", async () => {
  useLyricsState.getState().setLyrics([]);
  await act(async () => root.render(<AlignChip onSearchLyrics={vi.fn()} onUploadLyrics={vi.fn()} />));
  expect(text()).toBeNull();
});
