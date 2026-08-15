import React, { act, type ImgHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@heroui/react", () => ({
  Image: (props: ImgHTMLAttributes<HTMLImageElement>) => <img alt="" {...props} />,
}));

vi.mock("@remixicon/react", () => ({
  RiFileImageLine: () => <span>图片占位</span>,
}));

import Image from "@/components/image";

describe("Image", () => {
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

  const render = async (element: React.ReactNode) => {
    await act(async () => {
      root.render(element);
    });
  };

  it("为 B 站 HTTP 封面升级 HTTPS、移除来源，并保留图片缩放参数", async () => {
    await render(
      <Image
        src="http://i1.hdslb.com/bfs/archive/cover-a.jpg"
        params="672w_378h_1c.avif"
        emptyPlaceholder={<span data-testid="placeholder" />}
      />,
    );

    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", "https://i1.hdslb.com/bfs/archive/cover-a.jpg@672w_378h_1c.avif");
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("只记录具体失败 URL，换封面后恢复加载而不是永久显示占位", async () => {
    const onError = vi.fn();
    await render(
      <Image
        src="http://i0.hdslb.com/bfs/archive/cover-a.jpg"
        onError={onError}
        emptyPlaceholder={<span data-testid="placeholder" />}
      />,
    );

    await act(async () => {
      container.querySelector("img")?.dispatchEvent(new Event("error"));
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-testid="placeholder"]')).toBeInTheDocument();

    await render(
      <Image
        src="http://i0.hdslb.com/bfs/archive/cover-b.jpg"
        onError={onError}
        emptyPlaceholder={<span data-testid="placeholder" />}
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute("src", "https://i0.hdslb.com/bfs/archive/cover-b.jpg");
    expect(container.querySelector('[data-testid="placeholder"]')).toBeNull();
  });

  it("不覆盖非 B 站图片调用方指定的 referrerPolicy", async () => {
    await render(<Image src="http://images.example.com/cover.jpg" referrerPolicy="origin" />);

    expect(container.querySelector("img")).toHaveAttribute("src", "http://images.example.com/cover.jpg");
    expect(container.querySelector("img")).toHaveAttribute("referrerpolicy", "origin");
  });
});
