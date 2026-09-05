import React, { act, useImperativeHandle, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ viewport: null as HTMLDivElement | null }));

vi.mock("@/platform", () => ({ isWeb: true }));
vi.mock("overlayscrollbars-react", () => ({
  OverlayScrollbarsComponent: ({ ref, children }: { ref: Ref<unknown>; children: ReactNode }) => {
    useImperativeHandle(ref, () => ({
      osInstance: () => ({ elements: () => ({ viewport: mock.viewport }) }),
    }));
    return <div>{children}</div>;
  },
}));

import ScrollContainer from "@/components/scroll-container";

describe("inner scroll position reset", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (resetOnChange?: unknown) => {
    act(() => root.render(<ScrollContainer resetOnChange={resetOnChange}>list</ScrollContainer>));
  };

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    mock.viewport = document.createElement("div");
    document.body.append(container, mock.viewport);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    mock.viewport?.remove();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it.each(["next-folder", 0, "", false, null])("resets the viewport for key %s, not the document", key => {
    const windowScroll = vi.fn();
    vi.stubGlobal("scrollTo", windowScroll);
    render("previous-folder");
    mock.viewport!.scrollTop = 800;
    mock.viewport!.scrollLeft = 20;
    render(key);

    expect(mock.viewport!.scrollTop).toBe(0);
    expect(mock.viewport!.scrollLeft).toBe(0);
    expect(windowScroll).not.toHaveBeenCalled();
  });

  it("keeps scroll position on ordinary rerenders with the same key", () => {
    render("same-folder");
    mock.viewport!.scrollTop = 800;
    render("same-folder");
    expect(mock.viewport!.scrollTop).toBe(800);
  });

  it("leaves containers without an explicit reset key alone", () => {
    mock.viewport!.scrollTop = 800;
    render();
    expect(mock.viewport!.scrollTop).toBe(800);
  });
});
