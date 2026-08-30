/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- module mocks preserve production hook names */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchMocks = vi.hoisted(() => ({
  get: vi.fn(),
  log: { warn: vi.fn() },
}));

vi.mock("@heroui/react", () => ({
  addToast: vi.fn(),
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button type="button" onClick={() => onPress?.()}>
      {children}
    </button>
  ),
  Spinner: () => <div data-testid="spinner">加载中</div>,
}));
vi.mock("@/platform", () => ({
  default: { addMediaDownloadTask: vi.fn(), openExternal: vi.fn() },
  log: searchMocks.log,
}));
vi.mock("@/service/web-interface-search-type", () => ({
  getWebInterfaceWbiSearchType: searchMocks.get,
}));
vi.mock("@/components/empty", () => ({ default: () => <div data-testid="empty">暂无内容</div> }));
vi.mock("@/pages/search/video-list/search-header", () => ({ default: () => null }));
vi.mock("@/pages/search/video-list/list", () => ({
  default: ({ items }: { items: unknown[] }) => <div data-testid="results">{items.length}</div>,
}));
vi.mock("@/pages/search/video-list/grid-list", () => ({
  default: ({ items }: { items: unknown[] }) => <div data-testid="results">{items.length}</div>,
}));
vi.mock("@/store/modal", () => ({
  useModalStore: { getState: () => ({ onOpenFavSelectModal: vi.fn() }) },
}));
vi.mock("@/store/play-list", () => ({
  usePlayList: { getState: () => ({ addList: vi.fn(), addToNext: vi.fn(), play: vi.fn() }) },
}));
vi.mock("@/store/settings", () => ({
  useSettings: (selector: (state: { displayMode: "list" }) => unknown) => selector({ displayMode: "list" }),
}));

import SearchVideo from "@/pages/search/video-list";

const successResponse = {
  code: 0,
  data: { numResults: 1, result: [{ aid: 1, bvid: "BV1", title: "结果", author: "up", pic: "//pic" }] },
};

const settle = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};

describe("搜索列表失败恢复", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    searchMocks.get.mockReset();
    searchMocks.log.warn.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("把 B 站业务错误与网络错误显示为可重试状态", async () => {
    searchMocks.get.mockResolvedValueOnce({ code: -400, message: "请求错误" });

    await act(async () => {
      root.render(<SearchVideo keyword="螺旋 9lana" getScrollElement={() => null} />);
    });
    await settle();

    expect(searchMocks.get).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="spinner"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toHaveTextContent("搜索加载失败，请检查网络后重试");
    expect(container.querySelector("button")).toHaveTextContent("重新加载");
    expect(container.querySelector('[data-testid="empty"]')).toBeNull();

    searchMocks.get.mockResolvedValueOnce(successResponse);
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    await settle();

    expect(searchMocks.get).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="results"]')).toHaveTextContent("1");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
