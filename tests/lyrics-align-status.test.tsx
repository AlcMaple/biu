import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@heroui/react", () => ({ Spinner: () => <span data-testid="spinner" /> }));
vi.mock("@/store/play-list", async () => {
  const { create } = await import("zustand");
  const item = { id: "a", bvid: "BV1za41197Y9", cid: "813345505", title: "背对背拥抱" };
  return {
    usePlayList: create(() => ({ playId: "a", list: [item], getPlayItem: () => item })),
  };
});

import AlignStatus from "@/components/lyrics/align-status";
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

const text = () => host.querySelector('[role="status"]')?.textContent ?? null;

it("tells line-estimated lyrics apart from aligned ones", async () => {
  await act(async () => root.render(<AlignStatus />));
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

it("shows the hidden automatic job with its queue position", async () => {
  await act(async () => root.render(<AlignStatus />));
  await act(async () =>
    useLyricsAlignSession.setState({
      target,
      hidden: true,
      phase: { kind: "working", view: { id: "j", state: "queued", position: 3 } as AlignJobView },
    }),
  );
  expect(text()).toContain("对齐中");
  expect(text()).toContain("前面 3 首");
  expect(host.querySelector('[data-testid="spinner"]')).not.toBeNull();
});

it("steps aside while the align bar is showing the same thing", async () => {
  await act(async () => root.render(<AlignStatus />));
  await act(async () =>
    useLyricsAlignSession.setState({ target, hidden: false, phase: { kind: "failed", message: "歌词和音频对不上" } }),
  );
  expect(text()).toBeNull();
});

it("renders nothing without lyrics", async () => {
  useLyricsState.getState().setLyrics([]);
  await act(async () => root.render(<AlignStatus />));
  expect(text()).toBeNull();
});
