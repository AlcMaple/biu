/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- module mocks preserve production hook names */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@heroui/react", () => ({
  Link: ({ children, href }: { children?: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
  Skeleton: () => <div data-testid="skeleton" />,
  User: ({ name }: { name?: React.ReactNode }) => <div data-testid="owner">{name}</div>,
}));
vi.mock("@remixicon/react", () => ({
  RiEdit2Line: () => null,
}));
vi.mock("ahooks", () => ({
  useRequest: () => ({ data: { card: { face: "https://example.com/face.png", name: "示例用户" } } }),
}));
vi.mock("@/common/hooks/use-responsive", () => ({
  useIsMobileLayout: () => false,
}));
vi.mock("@/common/utils/fav", () => ({
  isPrivateFav: () => false,
}));
vi.mock("@/components/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt="" {...props} />,
}));
vi.mock("@/platform", () => ({
  isWeb: true,
}));
vi.mock("@/service/user-account", () => ({
  getWebInterfaceCard: vi.fn(),
}));

import { CollectionType } from "@/common/constants/collection";
import Header from "@/pages/video-collection/header";

describe("本地歌单头部", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("没有 upMid 时不渲染头像和用户名", () => {
    act(() => {
      root.render(<Header type={CollectionType.Favorite} title="本地歌单" mediaCount={1} />);
    });

    expect(container.querySelector("h1")).toHaveTextContent("本地歌单");
    expect(container.querySelector('[data-testid="owner"]')).toBeNull();
  });

  it("有 upMid 时保留在线收藏夹的用户信息", () => {
    act(() => {
      root.render(<Header type={CollectionType.Favorite} title="在线收藏夹" upMid={42} mediaCount={1} />);
    });

    expect(container.querySelector('[data-testid="owner"]')).toHaveTextContent("示例用户");
  });
});
