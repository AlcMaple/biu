import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const videoTitle = "高达跨时 GQuuuuuuX 第 4 话 插入曲 欲しいものすべて Ver.MAMAMAJO";
const manualQuery = "欲しいものすべて Ver.MAMAMAJO";
const uploader = "红色的风";
const trackEntry = "BV-fixture-42";

const mocks = vi.hoisted(() => ({
  searchNeteaseSongs: vi.fn<(params: SearchSongByNeteaseParams) => Promise<SearchSongByNeteaseResponse>>(),
  getNeteaseLyrics: vi.fn<() => Promise<GetLyricsByNeteaseResponse>>(),
  searchLrclibLyrics: vi.fn(),
  searchProviderLyrics: vi.fn(),
  getProviderLyrics: vi.fn(),
  getStore: vi.fn<() => Promise<Record<string, MusicLyrics>>>(),
  setStore: vi.fn<(name: string, value: Record<string, MusicLyrics>) => Promise<void>>(),
}));

vi.mock("@/platform", () => ({ default: mocks, isWeb: true }));
vi.mock("@/store/play-list", () => {
  const state = {
    playId: "song-a",
    getPlayItem: () => ({ title: videoTitle, ownerName: uploader, bvid: "BV-fixture", cid: "42" }),
  };
  const selectPlayList = <T,>(selector: (value: typeof state) => T) => selector(state);
  return { usePlayList: Object.assign(selectPlayList, { getState: () => state }) };
});

import LyricsSearchModal from "@/components/lyrics-search-modal";

let root: Root;
let host: HTMLDivElement;
let cache: Record<string, MusicLyrics>;

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
  cache = {};
  mocks.getStore.mockImplementation(async () => cache);
  mocks.setStore.mockImplementation(async (_name, value) => {
    cache = JSON.parse(JSON.stringify(value)) as Record<string, MusicLyrics>;
  });
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

const pickRow = (name: string) =>
  act(async () => {
    Array.from(document.querySelectorAll<HTMLTableRowElement>("tr"))
      .find(row => row.textContent?.includes(name))!
      .click();
  });

it("单次采用纯音乐，替换同一首歌的旧歌词；选回歌词后清除标记", async () => {
  cache = {
    [trackEntry]: {
      source: "aligned",
      lyrics: "[00:01]旧歌词",
      tLyrics: "[00:01]旧译文",
      offset: 900,
      fontSize: 22,
      alignment: { lyricsHash: "stale", lines: [] },
      preAlign: { lyrics: "旧词" },
    },
    other: { lyrics: "[00:01]另一首歌" },
  };
  mocks.searchLrclibLyrics.mockResolvedValue([
    { id: 10, trackName: "原声曲 T_001", instrumental: true, syncedLyrics: null, plainLyrics: null },
    { id: 11, trackName: "有人声的版本", instrumental: false, syncedLyrics: "[00:01]歌词正文" },
  ]);
  await open();
  await click("LrcLib");
  expect(document.querySelector('[aria-label="lrclib songs"]')).not.toHaveTextContent("纯音乐");
  await pickRow("原声曲 T_001");
  expect(mocks.setStore).not.toHaveBeenCalled();
  await click("采用纯音乐");

  expect(cache[trackEntry]).toEqual({ source: "manual", instrumental: true, offset: 0, fontSize: 22 });
  expect(cache.other).toEqual({ lyrics: "[00:01]另一首歌" });

  await pickRow("有人声的版本");
  await click("采用歌词");
  expect(cache[trackEntry]).toEqual({ source: "manual", lyrics: "[00:01]歌词正文", offset: 0, fontSize: 22 });
});

it("LrcLib 仅有纯文本时提示无时间轴，不把没时间轴的歌标成纯音乐", async () => {
  mocks.searchLrclibLyrics.mockResolvedValue([{ id: 1, trackName: "只有纯文本", plainLyrics: "这是歌词正文" }]);
  await open();
  await click("LrcLib");
  await pickRow("只有纯文本");
  expect(document.body).toHaveTextContent("只有纯文本歌词，没有时间轴");
  expect(document.body).not.toHaveTextContent("采用纯音乐");
  expect(mocks.setStore).not.toHaveBeenCalled();
});

it("网易云的非歌词字段有文本也不当成可采用的时间轴", async () => {
  mocks.searchNeteaseSongs.mockResolvedValue(song("T_001"));
  mocks.getNeteaseLyrics.mockResolvedValue({ lrc: { lyric: "曲目版权信息" } });
  await open();
  await edit(manualQuery);
  await pressEnter();
  await pickRow("T_001");
  expect(document.body).toHaveTextContent("网易云没有返回带时间轴的歌词");
  expect(document.body).not.toHaveTextContent("采用纯音乐");
  await click("采用歌词");
  expect(mocks.setStore).not.toHaveBeenCalled();
});

it("网易云原声条目仅有制作人员信息时，一次点击采用无歌词版本", async () => {
  mocks.searchNeteaseSongs.mockResolvedValue(song("欲しいものすべて (T_001)"));
  mocks.getNeteaseLyrics.mockResolvedValue({ code: 200, lrc: { lyric: "[00:0.000] 作曲 : 照井順政" } });
  await open();
  await edit(manualQuery);
  await pressEnter();
  await pickRow("欲しいものすべて (T_001)");
  expect(document.body).not.toHaveTextContent("此来源标记为纯音乐");
  expect(mocks.setStore).not.toHaveBeenCalled();
  expect(document.body).not.toHaveTextContent("采用纯音乐");
  await click("采用无歌词版本");
  expect(cache[trackEntry]).toEqual({ source: "manual", noLyrics: true, offset: 0 });
});

it.each([
  ["QQ 音乐", "qq"],
  ["酷狗", "kugou"],
  ["AMLL", "amll"],
])("%s 未返回歌词时只采用无歌词版本", async (label, provider) => {
  mocks.searchProviderLyrics.mockResolvedValue({
    ok: true,
    data: [{ provider, id: "x", title: "没有歌词的条目", artists: ["歌手"] }],
  });
  mocks.getProviderLyrics.mockResolvedValue({
    ok: false,
    error: { kind: "not_found", provider, message: "未返回歌词" },
  });
  await open();
  await click(label);
  await pickRow("没有歌词的条目");
  expect(document.body).toHaveTextContent("未返回歌词");
  expect(document.body).not.toHaveTextContent("此来源标记为纯音乐");
  expect(mocks.setStore).not.toHaveBeenCalled();
  expect(document.body).not.toHaveTextContent("采用纯音乐");
  await click("采用无歌词版本");
  expect(cache[trackEntry]).toEqual({ source: "manual", noLyrics: true, offset: 0 });
});

it("网易云的明确纯音乐提示直接进入可采用的纯音乐预览", async () => {
  mocks.searchNeteaseSongs.mockResolvedValue(song("配乐曲目"));
  mocks.getNeteaseLyrics.mockResolvedValue({ lrc: { lyric: "[00:00.000]纯音乐，请欣赏" } });
  await open();
  await edit(manualQuery);
  await pressEnter();
  await pickRow("配乐曲目");
  expect(document.body).toHaveTextContent("此来源标记为纯音乐");
  expect(document.body).not.toHaveTextContent("歌词原文");
  await click("采用纯音乐");
  expect(cache[trackEntry]).toEqual({ source: "manual", instrumental: true, offset: 0 });
});

it.each([
  ["QQ 音乐", "qq"],
  ["酷狗", "kugou"],
  ["AMLL", "amll"],
])("%s 的明确纯音乐结果使用统一预览", async (label, provider) => {
  mocks.searchProviderLyrics.mockResolvedValue({
    ok: true,
    data: [{ provider, id: "x", title: "纯配乐条目", artists: [] }],
  });
  mocks.getProviderLyrics.mockResolvedValue({ ok: true, data: { provider, sourceId: "x", instrumental: true } });
  await open();
  await click(label);
  await pickRow("纯配乐条目");
  expect(document.body).toHaveTextContent("此来源标记为纯音乐");
  expect(document.body).not.toHaveTextContent("歌词原文");
  await click("采用纯音乐");
  expect(cache[trackEntry]).toMatchObject({ instrumental: true });
});

it("没有搜索结果时不出现采用入口，限流时保留原因", async () => {
  mocks.searchProviderLyrics.mockResolvedValueOnce({ ok: true, data: [] }).mockResolvedValueOnce({
    ok: false,
    error: { kind: "rate_limited", provider: "amll", message: "AMLL 请求过于频繁" },
  });
  await open();
  await click("AMLL");
  expect(document.body).toHaveTextContent("没有搜到");
  expect(document.body).not.toHaveTextContent("采用纯音乐");
  expect(document.body).not.toHaveTextContent("采用无歌词版本");
  await click("搜索");
  expect(document.body).toHaveTextContent("AMLL 请求过于频繁");
  expect(document.body).not.toHaveTextContent("采用无歌词版本");
  expect(mocks.setStore).not.toHaveBeenCalled();
});

it("LrcLib 空曲目采用无歌词，之后换回同步歌词时恢复普通歌词", async () => {
  mocks.searchLrclibLyrics.mockResolvedValue([
    { id: 1, trackName: "空白条目", syncedLyrics: null, plainLyrics: null },
    { id: 2, trackName: "正常条目", syncedLyrics: "[00:01]正文" },
  ]);
  await open();
  await click("LrcLib");
  await pickRow("空白条目");
  expect(document.body).not.toHaveTextContent("采用纯音乐");
  expect(mocks.setStore).not.toHaveBeenCalled();
  await click("采用无歌词版本");
  expect(cache[trackEntry]).toEqual({ source: "manual", noLyrics: true, offset: 0 });
  await pickRow("正常条目");
  await click("采用歌词");
  expect(cache[trackEntry]).toEqual({ source: "manual", lyrics: "[00:01]正文", offset: 0 });
});
