import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderLyrics: vi.fn(),
  playId: "song-a",
}));

vi.mock("@/platform", () => ({
  default: { getProviderLyrics: mocks.getProviderLyrics },
  isWeb: false,
  isElectron: true,
}));
vi.mock("@/store/play-list", () => ({ usePlayList: { getState: () => ({ playId: mocks.playId }) } }));

import ProviderTab from "@/components/lyrics-search-modal/provider-tab";

const candidate = {
  provider: "amll" as const,
  id: "7192686136682066",
  title: "晴天",
  artists: ["周杰伦"],
  timing: "word" as const,
};
const doc = {
  ok: true,
  data: {
    provider: "amll",
    sourceId: "7192686136682066",
    author: "Sikz1218",
    lyrics: {
      format: "ttml",
      timing: "word",
      lines: [{ startMs: 1000, endMs: 2000, text: "故事", words: [{ startMs: 1000, endMs: 2000, text: "故事" }] }],
    },
  },
};

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
  mocks.playId = "song-a";
  mocks.getProviderLyrics.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const flush = () => act(async () => new Promise<void>(resolve => setTimeout(resolve, 0)));
const button = (text: string) =>
  Array.from(document.querySelectorAll("button")).find(item => item.textContent?.includes(text)) as HTMLButtonElement;

async function openPreview(onAdopt = vi.fn(async () => true)) {
  await act(async () =>
    root.render(<ProviderTab provider="amll" candidates={[candidate]} loading={false} onAdopt={onAdopt} />),
  );
  const row = Array.from(host.querySelectorAll("tr")).find(item => item.textContent?.includes("晴天"))!;
  await act(async () => row.click());
  await flush();
  return onAdopt;
}

it("预览显示来源与时间轴类型，采用时带上来源元数据", async () => {
  mocks.getProviderLyrics.mockResolvedValue(doc);
  const onAdopt = await openPreview();

  expect(document.body.textContent).toContain("AMLL · TTML · 逐字");
  expect(document.body.textContent).toContain("歌词作者 Sikz1218");
  expect(document.body.textContent).toContain("[00:01.000]故事");
  expect(onAdopt).not.toHaveBeenCalled();

  await act(async () => button("采用歌词").click());
  expect(onAdopt).toHaveBeenCalledWith(
    expect.objectContaining({
      lyrics: "[00:01.000]故事",
      origin: expect.objectContaining({ provider: "amll", sourceId: "7192686136682066", timing: "word" }),
      nativeTiming: expect.objectContaining({ lyrics: "[00:01.000]故事" }),
    }),
  );
});

it("预览期间切了歌：拒绝采用，不写到新歌上", async () => {
  mocks.getProviderLyrics.mockResolvedValue(doc);
  const onAdopt = await openPreview();
  mocks.playId = "song-b";

  await act(async () => button("采用歌词").click());
  expect(onAdopt).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("已经切到别的歌了");
});

it("取词失败显示具体原因，不能采用", async () => {
  mocks.getProviderLyrics.mockResolvedValue({
    ok: false,
    error: { kind: "rate_limited", provider: "amll", status: 429, message: "AMLL请求过于频繁，请稍后再试" },
  });
  await openPreview();

  expect(document.body.textContent).toContain("连续重试会延长限制");
  expect(button("采用歌词").disabled).toBe(true);
  expect(mocks.getProviderLyrics).toHaveBeenCalledTimes(1);
});

it("关掉预览后才回来的旧结果不会再弹出来", async () => {
  let resolve!: (value: unknown) => void;
  mocks.getProviderLyrics.mockReturnValue(new Promise(r => (resolve = r)));
  await openPreview();
  await act(async () => button("关闭").click());
  resolve(doc);
  await flush();
  expect(document.body.textContent).not.toContain("[00:01.000]故事");
});

it("搜索出错时显示错误，而不是「没搜到」", async () => {
  await act(async () =>
    root.render(
      <ProviderTab
        provider="qq"
        candidates={[]}
        loading={false}
        error="QQ 音乐检索异常（业务码 2001）"
        onAdopt={vi.fn()}
      />,
    ),
  );
  expect(host.textContent).toContain("业务码 2001");
  expect(host.textContent).not.toContain("没有搜到");
});
