import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({
  user: { isLogin: false, mid: 0 } as { isLogin: boolean; mid: number } | undefined,
  hiddenMenuKeys: [] as string[],
  isAdmin: false,
  pendingCount: 0,
  refresh: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/store/user", () => {
  const selectUser = (select: (state: typeof model) => unknown) => select(model);
  return { useUser: selectUser };
});
vi.mock("@/store/settings", () => {
  const selectSettings = (select: (state: typeof model) => unknown) => select(model);
  return { useSettings: selectSettings };
});
vi.mock("@/store/align-review", () => {
  const selectReview = (select: (state: typeof model) => unknown) => select(model);
  return {
    useAlignReview: Object.assign(selectReview, { getState: () => model }),
    refreshAlignReviewOnFocus: vi.fn(),
  };
});
vi.mock("@/platform", () => ({ isWeb: true }));
vi.mock("@/components/menu/menu-group", () => ({
  default: ({ items }: { items: { title: string; href?: string; onPress?: () => void }[] }) => (
    <nav>
      {items.map(item => (
        <button key={item.title} type="button" data-href={item.href} onClick={item.onPress}>
          {item.title}
        </button>
      ))}
    </nav>
  ),
}));

import DefaultMenus from "@/layout/side/default-menu";

const likedPath = "/local-collection/-1";

describe("访客本地红心歌单入口", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    model.user = { isLogin: false, mid: 0 };
    model.hiddenMenuKeys = [];
    model.isAdmin = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  const render = (isCollapsed = false, onOpenAddFavorite = vi.fn()) => {
    act(() => root.render(<DefaultMenus isCollapsed={isCollapsed} onOpenAddFavorite={onOpenAddFavorite} />));
    return onOpenAddFavorite;
  };

  it.each([false, true])("访客在折叠=%s时可找回红心歌单，不出现云端和创建入口", isCollapsed => {
    const onCreate = render(isCollapsed);
    expect(container.querySelector(`[data-href="${likedPath}"]`)).toHaveTextContent("我喜欢的音乐");
    for (const href of ["/follow", "/later", "/history", "/lyrics-submissions", "/lyrics-review", "/local-music"]) {
      expect(container.querySelector(`[data-href="${href}"]`)).toBeNull();
    }
    expect(container).not.toHaveTextContent("创建收藏夹");
    expect(model.refresh).not.toHaveBeenCalled();
    expect(model.reset).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it.each([false, true])("登录后折叠=%s时沿用原收藏夹分组，不重复红心入口", isCollapsed => {
    model.user = { isLogin: true, mid: 900001 };
    const onCreate = render(isCollapsed);
    expect(container.querySelector(`[data-href="${likedPath}"]`)).toBeNull();
    expect(container.querySelector('[data-href="/history"]')).toBeInTheDocument();
    const createButton = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "创建收藏夹");
    if (isCollapsed) {
      expect(createButton).toBeDefined();
      act(() => createButton?.click());
      expect(onCreate).toHaveBeenCalledTimes(1);
    } else {
      expect(createButton).toBeUndefined();
    }
  });

  it("保留已有隐藏菜单偏好", () => {
    model.hiddenMenuKeys = [likedPath];
    render();
    expect(container.querySelector(`[data-href="${likedPath}"]`)).toBeNull();
    expect(container.querySelector('[data-href="/"]')).toBeInTheDocument();
  });

  it("登录状态变化后移除访客入口，不触发创建动作", () => {
    const onCreate = render();
    expect(container.querySelector(`[data-href="${likedPath}"]`)).toBeInTheDocument();
    model.user = { isLogin: true, mid: 900001 };
    render(false, onCreate);
    expect(container.querySelector(`[data-href="${likedPath}"]`)).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("用户状态尚未载入时也不暴露需要登录的能力", () => {
    model.user = undefined;
    render(true);
    expect(container.querySelector(`[data-href="${likedPath}"]`)).toBeInTheDocument();
    expect(container).not.toHaveTextContent("创建收藏夹");
    expect(model.refresh).not.toHaveBeenCalled();
  });
});
