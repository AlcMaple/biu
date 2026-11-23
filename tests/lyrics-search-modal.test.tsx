import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const videoTitle = "高达跨时 GQuuuuuuX 第 4 话 插入曲 欲しいものすべて Ver.MAMAMAJO";
const manualQuery = "欲しいものすべて Ver.MAMAMAJO";
const uploader = "红色的风";

const mocks = vi.hoisted(() => ({
  searchNeteaseSongs: vi.fn<(params: SearchSongByNeteaseParams) => Promise<SearchSongByNeteaseResponse>>(),
  searchLrclibLyrics: vi.fn(),
}));

vi.mock("@/platform", () => ({ default: mocks }));
vi.mock("@/store/play-list", () => {
  const state = {
    playId: "song-a",
    getPlayItem: () => ({ title: videoTitle, ownerName: uploader }),
  };
  const selectPlayList = <T,>(selector: (value: typeof state) => T) => selector(state);
  return { usePlayList: selectPlayList };
});

import LyricsSearchModal from "@/components/lyrics-search-modal";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.searchNeteaseSongs.mockResolvedValue({ result: { songs: [] } });
  mocks.searchLrclibLyrics.mockResolvedValue([]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const input = () => document.querySelector<HTMLInputElement>('input[placeholder="请输入歌曲或歌手名称"]')!;
const open = () => act(async () => root.render(<LyricsSearchModal isOpen onOpenChange={vi.fn()} />));
const click = (text: string) =>
  act(async () => {
    Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find(el => el.textContent === text)!
      .click();
  });
const pressEnter = (event: KeyboardEventInit = {}) =>
  act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...event })));
const edit = (value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
const searched = () => mocks.searchNeteaseSongs.mock.calls.map(([params]) => params.s);
const song = (name: string) => ({ result: { songs: [{ id: 1, name }] } });

it.each(["回车", "搜索按钮"])("使用%s时只搜手动输入的内容并显示原来的结果", async submit => {
  await open();
  mocks.searchNeteaseSongs.mockClear();
  mocks.searchNeteaseSongs.mockImplementation(async ({ s }) =>
    s === uploader ? song(uploader) : s === manualQuery ? song("曲库返回的近似歌曲") : song("无关歌曲"),
  );

  await edit(manualQuery);
  if (submit === "回车") await pressEnter();
  else await click("搜索");

  expect(input()).toHaveValue(manualQuery);
  expect(searched()).toEqual([manualQuery]);
  expect(document.body).toHaveTextContent("曲库返回的近似歌曲");
});

it("打开只预填关键词，搜索未编辑的默认词时仍可用标题候选纠正", async () => {
  mocks.searchNeteaseSongs.mockImplementation(async ({ s }) =>
    s === uploader ? song(uploader) : song("曲库返回的近似歌曲"),
  );
  await open();
  expect(input()).toHaveValue(videoTitle);
  expect(searched()).toEqual([]);
  await pressEnter();

  expect(searched()).toEqual([videoTitle, uploader]);
  expect(input()).toHaveValue(uploader);
});

it("开始编辑后，已发出的自动候选请求不会覆盖输入", async () => {
  let finishFallback!: (response: SearchSongByNeteaseResponse) => void;
  const pending = new Promise<SearchSongByNeteaseResponse>(resolve => (finishFallback = resolve));
  mocks.searchNeteaseSongs.mockResolvedValueOnce(song("曲库返回的近似歌曲")).mockReturnValueOnce(pending);
  await open();
  await pressEnter();
  expect(searched()).toEqual([videoTitle, uploader]);

  await edit("我正在输入");
  await act(async () => finishFallback(song(uploader)));

  expect(input()).toHaveValue("我正在输入");
  expect(document.body).toHaveTextContent("曲库返回的近似歌曲");
});

it("点击「试试」只搜索选中的推荐词", async () => {
  await open();
  mocks.searchNeteaseSongs.mockClear();
  mocks.searchNeteaseSongs.mockResolvedValueOnce(song("曲库返回的近似歌曲")).mockResolvedValueOnce(song(videoTitle));

  await click(uploader);
  expect(searched()).toEqual([uploader]);
  expect(input()).toHaveValue(uploader);
});

it("手动编辑后切换渠道，沿用输入而不回退到标题候选", async () => {
  await open();
  await edit("自定义歌名");
  await click("LrcLib");
  expect(mocks.searchLrclibLyrics).toHaveBeenCalledExactlyOnceWith({ q: "自定义歌名" });

  mocks.searchNeteaseSongs.mockClear();
  mocks.searchNeteaseSongs.mockResolvedValueOnce(song("曲库返回的近似歌曲")).mockResolvedValueOnce(song(videoTitle));
  await click("网易云");
  expect(searched()).toEqual(["自定义歌名"]);
  expect(input()).toHaveValue("自定义歌名");
});

it.each([{ isComposing: true }, { keyCode: 229 }])("输入法选字的回车不提交搜索（%j）", async event => {
  await open();
  mocks.searchNeteaseSongs.mockClear();
  await edit(manualQuery);
  await pressEnter(event);
  expect(searched()).toEqual([]);

  await pressEnter();
  expect(searched()).toEqual([manualQuery]);
});
