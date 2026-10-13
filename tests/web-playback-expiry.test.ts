import { afterEach, describe, expect, it, vi } from "vitest";

import { isUrlValid } from "@/common/utils/audio";
import { usePlayProgress } from "@/store/play-progress";
import { BILIBILI_MEDIA_PROXY_PREFIX } from "@shared/bilibili-web-proxy";

const TOKEN = `${BILIBILI_MEDIA_PROXY_PREFIX}/${"a".repeat(43)}`;
const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("Web 同源媒体地址有效期", () => {
  it("带到期提示的同源地址过期（或临近过期）后需要重新取址", () => {
    expect(isUrlValid(`${TOKEN}?e=${nowSeconds() + 3600}`)).toBe(true);
    expect(isUrlValid(`${TOKEN}?e=${nowSeconds() + 30}`)).toBe(false);
    expect(isUrlValid(`${TOKEN}?e=${nowSeconds() - 1}`)).toBe(false);
  });

  it("旧格式（无到期提示）的同源地址保持原行为", () => {
    expect(isUrlValid(TOKEN)).toBe(true);
  });
});

describe("播放进度落盘", () => {
  afterEach(() => localStorage.clear());

  it("切歌清零会立刻清掉上一首的落盘进度，刷新后不会套到新歌上", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    usePlayProgress.getState().setCurrentTime(90);
    expect(localStorage.getItem("play-current-time")).toBe("90");

    usePlayProgress.getState().setCurrentTime(0);
    expect(localStorage.getItem("play-current-time")).toBeNull();
    expect(usePlayProgress.getState().initCurrentTime()).toBe(0);
    vi.useRealTimers();
  });
});
