import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/platform/detect", () => ({
  isAndroid: false,
  isElectron: false,
  isIOS: false,
  isNativeMobile: false,
  isWeb: true,
}));

import { useMusicListColumns, type MusicListColumns } from "@/components/music-list-item/styles";

let width = 1280;

// use-responsive 只挂一次监听、之后不摘，所以这个集合要跨用例保留，不能在 beforeEach 里清空。
const listeners = new Set<() => void>();

/** 改视口并派发 change —— 与真实浏览器一致，也让 hook 的缓存跟着更新 */
const setViewportWidth = (next: number) => {
  width = next;
  listeners.forEach(listener => listener());
};

/**
 * 只按 `(max-width: Npx)` 求值——use-responsive 里用到的就是这一种形式。
 */
const matchMediaStub = (query: string): MediaQueryList => {
  const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Number.POSITIVE_INFINITY);

  return {
    get matches() {
      return width <= max;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  } as unknown as MediaQueryList;
};

/** 栅格模板里的列数 */
const countGridColumns = (gridCols: string) => gridCols.replace(/^grid-cols-\[|\]$/g, "").split("_").length;

/** 实际渲染出来的单元格数：序号 + 标题 + 可选列 + 操作 */
const countRenderedCells = (columns: MusicListColumns) =>
  2 + [columns.showUp, columns.showPlayCount, columns.showPubTime, columns.showDuration].filter(Boolean).length + 1;

describe("歌曲列表响应式栅格", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: MusicListColumns;

  const Probe = ({ isCompact, hidePubTime }: { isCompact?: boolean; hidePubTime?: boolean }) => {
    latest = useMusicListColumns(isCompact, hidePubTime);
    return null;
  };

  const render = (props: { isCompact?: boolean; hidePubTime?: boolean } = {}) => {
    act(() => {
      root.render(<Probe {...props} />);
    });
    return latest;
  };

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    setViewportWidth(1280);
    vi.stubGlobal("matchMedia", matchMediaStub);
    window.matchMedia = matchMediaStub;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it.each([
    ["桌面", 1280, {}],
    ["桌面紧凑", 1280, { isCompact: true }],
    ["桌面紧凑无投稿时间", 1280, { isCompact: true, hidePubTime: true }],
    ["桌面无投稿时间", 1280, { hidePubTime: true }],
    ["平板", 1000, {}],
    ["平板紧凑", 1000, { isCompact: true }],
    ["窄平板", 800, {}],
    ["移动", 390, {}],
    ["移动紧凑", 390, { isCompact: true }],
  ])("%s 下栅格列数与渲染单元格数一致", (_label, viewport, props) => {
    setViewportWidth(viewport);
    const columns = render(props);

    expect(countGridColumns(columns.gridCols)).toBe(countRenderedCells(columns));
  });

  it("按断点收起低优先级列", () => {
    expect(render()).toMatchObject({ isMobile: false, showPlayCount: true, showPubTime: true, showDuration: true });

    act(() => setViewportWidth(1000));
    expect(latest).toMatchObject({ isMobile: false, showPlayCount: true, showPubTime: false, showUp: false });

    act(() => setViewportWidth(800));
    expect(latest).toMatchObject({ isMobile: false, showPlayCount: false, showDuration: true });

    act(() => setViewportWidth(390));
    expect(latest).toMatchObject({ isMobile: true, showPlayCount: false, showDuration: false });

    act(() => setViewportWidth(1280));
    expect(latest).toMatchObject({ isMobile: false, showPlayCount: true, showPubTime: true });
  });
});
