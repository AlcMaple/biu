/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- module mocks preserve production hook names */
import { act } from "react";
import { createRoot } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchMocks = vi.hoisted(() => ({
  keyword: "护甲虎牙",
  user: null as { isLogin: boolean; mid: number } | null,
}));

vi.mock("@heroui/react", () => ({
  Tab: ({ title }: { title: string }) => <button type="button">{title}</button>,
  Tabs: ({
    children,
    items,
    onSelectionChange,
  }: {
    children: (item: { label: string; value: string }) => React.ReactNode;
    items: Array<{ label: string; value: string }>;
    onSelectionChange?: (value: string) => void;
  }) => (
    <div>
      {items.some(item => item.value === "bili_user") && (
        <button type="button" data-testid="select-user" onClick={() => onSelectionChange?.("bili_user")}>
          选择用户
        </button>
      )}
      {items.map(children)}
    </div>
  ),
}));
vi.mock("@/components/empty", () => ({ default: () => <div>空状态</div> }));
vi.mock("@/components/scroll-container", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/pages/search/video-list", () => ({ default: () => <div>视频结果</div> }));
vi.mock("@/pages/search/user-list", () => ({ default: () => <div>用户结果</div> }));
vi.mock("@/store/search-history", () => ({
  useSearchHistory: (selector: (state: { keyword: string }) => unknown) => selector({ keyword: searchMocks.keyword }),
}));
vi.mock("@/store/user", () => ({
  useUser: (selector: (state: { user: typeof searchMocks.user }) => unknown) => selector({ user: searchMocks.user }),
}));

import Search from "@/pages/search";

describe("搜索用户标签登录门控", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    searchMocks.user = null;
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("未登录时只显示视频标签，不挂载用户结果", () => {
    const root = createRoot(container);
    act(() => {
      root.render(<Search />);
    });

    expect(container).toHaveTextContent("视频");
    expect(container).not.toHaveTextContent("用户");
    expect(container).not.toHaveTextContent("用户结果");

    act(() => root.unmount());
  });

  it("登录后恢复用户标签，退出登录时立即卸载用户结果", () => {
    searchMocks.user = { isLogin: true, mid: 1 };
    const root = createRoot(container);
    act(() => {
      root.render(<Search />);
    });

    expect(container).toHaveTextContent("视频");
    expect(container).toHaveTextContent("用户");

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-testid='select-user']")?.click();
    });
    expect(container).toHaveTextContent("用户结果");

    searchMocks.user = null;
    act(() => {
      root.render(<Search />);
    });
    expect(container).not.toHaveTextContent("用户结果");
    expect(container).not.toHaveTextContent("用户");

    act(() => root.unmount());
  });
});
