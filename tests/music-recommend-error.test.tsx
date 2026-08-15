import React, { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  getMusicComprehensiveWebRank: vi.fn(),
  getRegionFeedRcmd: vi.fn(),
}));

vi.mock("@heroui/react", () => ({
  addToast: vi.fn(),
  Spinner: () => <div data-testid="spinner">加载中</div>,
  Tab: ({ title }: { title: React.ReactNode }) => <span>{title}</span>,
  Tabs: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));

vi.mock("@remixicon/react", () => ({
  RiPlayFill: () => null,
}));

vi.mock("@/components/async-button", () => ({
  default: ({
    children,
    isDisabled,
    onPress,
  }: PropsWithChildren<{ isDisabled?: boolean; onPress?: () => void | Promise<void> }>) => (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => {
        void onPress?.();
      }}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/scroll-container", async () => {
  const { useImperativeHandle } = await import("react");

  return {
    default: ({ children, ref }: PropsWithChildren<{ ref?: React.Ref<{ osInstance: () => null }> }>) => {
      useImperativeHandle(ref, () => ({ osInstance: () => null }));
      return <div>{children}</div>;
    },
  };
});

vi.mock("@/platform", () => ({
  default: {
    addMediaDownloadTask: vi.fn(),
    openExternal: vi.fn(),
  },
  isNativeMobile: false,
  isWeb: true,
}));

vi.mock("@/service/music-comprehensive-web-rank", () => ({
  getMusicComprehensiveWebRank: serviceMocks.getMusicComprehensiveWebRank,
}));

vi.mock("@/service/web-interface-region-feed-rcmd", () => ({
  getRegionFeedRcmd: serviceMocks.getRegionFeedRcmd,
}));

vi.mock("@/store/modal", () => ({
  useModalStore: {
    getState: () => ({ onOpenFavSelectModal: vi.fn() }),
  },
}));

vi.mock("@/store/play-list", () => ({
  usePlayList: {
    getState: () => ({ addList: vi.fn(), addToNext: vi.fn() }),
  },
}));

vi.mock("@/store/settings", async () => {
  const { useState } = await import("react");

  return {
    useSettings: (selector: (state: { displayMode: "list" }) => unknown) => {
      const [state] = useState({ displayMode: "list" as const });
      return selector(state);
    },
  };
});

vi.mock("@/pages/music-recommend/grid-list", async () => {
  const { useEffect } = await import("react");

  return {
    default: ({
      hasMore,
      items,
      loading,
      onLoadMore,
    }: {
      hasMore: boolean;
      items: unknown[];
      loading: boolean;
      onLoadMore: () => void;
    }) => {
      useEffect(() => {
        if (hasMore && !loading) onLoadMore();
      }, [hasMore, loading, onLoadMore]);
      return <div data-count={items.length} data-testid="recommend-list" />;
    },
  };
});

vi.mock("@/pages/music-recommend/list", async () => {
  const { useEffect } = await import("react");

  return {
    default: ({
      hasMore,
      items,
      loading,
      onLoadMore,
    }: {
      hasMore: boolean;
      items: unknown[];
      loading: boolean;
      onLoadMore: () => void;
    }) => {
      useEffect(() => {
        if (hasMore && !loading) onLoadMore();
      }, [hasMore, loading, onLoadMore]);
      return <div data-count={items.length} data-testid="recommend-list" />;
    },
  };
});

vi.mock("@/pages/music-recommend/new-music-top", () => ({
  default: () => null,
}));

import MusicRecommend from "@/pages/music-recommend";

const makeArchive = (index: number) => ({
  aid: index,
  bvid: `BV${index}`,
  title: `推荐 ${index}`,
  cover: `cover-${index}`,
});

const successResponse = (indexes: number[]) => ({
  code: 0,
  data: { archives: indexes.map(makeArchive) },
});

const settle = async (rounds = 4) => {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
};

describe("推荐页请求失败", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  const renderPage = async () => {
    await act(async () => {
      root.render(<MusicRecommend />);
    });
    await settle();
  };

  const clickButton = async (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(item => item.textContent === label);
    if (!button) throw new Error(`没有找到按钮：${label}`);

    await act(async () => {
      button.click();
    });
    await settle();
  };

  it("首屏失败后停止自动翻页、收起 Spinner，并仅在用户重试后恢复", async () => {
    serviceMocks.getRegionFeedRcmd.mockRejectedValue({ code: "ERR_NETWORK" });

    await renderPage();
    await settle(6);

    expect(serviceMocks.getRegionFeedRcmd).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="spinner"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toHaveTextContent("推荐内容加载失败");
    expect(container.querySelector('[role="alert"]')).toHaveTextContent("Web 网络代理");

    serviceMocks.getRegionFeedRcmd.mockResolvedValueOnce(successResponse([1]));
    await clickButton("重新加载");

    expect(serviceMocks.getRegionFeedRcmd).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[data-testid="recommend-list"]')).toHaveAttribute("data-count", "1");
  });

  it("加载更多失败后回退页码、停止重复触发，并允许手动重试同一页", async () => {
    serviceMocks.getRegionFeedRcmd
      .mockResolvedValueOnce(successResponse(Array.from({ length: 15 }, (_, index) => index + 1)))
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockResolvedValueOnce(successResponse([16]));

    await renderPage();
    await settle(6);

    expect(serviceMocks.getRegionFeedRcmd).toHaveBeenCalledTimes(2);
    expect(serviceMocks.getRegionFeedRcmd.mock.calls[1]?.[0]).toMatchObject({ display_id: 2 });
    expect(container.querySelector('[role="alert"]')).toHaveTextContent("更多推荐加载失败");
    expect(container.querySelector('[role="alert"]')).toHaveTextContent("请求过于频繁");

    await settle(6);
    expect(serviceMocks.getRegionFeedRcmd).toHaveBeenCalledTimes(2);

    await clickButton("重试加载更多");

    expect(serviceMocks.getRegionFeedRcmd).toHaveBeenCalledTimes(3);
    expect(serviceMocks.getRegionFeedRcmd.mock.calls[2]?.[0]).toMatchObject({ display_id: 2 });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[data-testid="recommend-list"]')).toHaveAttribute("data-count", "16");
  });
});
