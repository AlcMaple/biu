import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocumentScroll } from "@/common/hooks/use-document-scroll";
import { useScrollElement } from "@/common/hooks/use-scroll-element";

let documentScroll = false;
const listeners = new Set<() => void>();

vi.mock("@/common/hooks/use-document-scroll", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useDocumentScroll: () =>
      useSyncExternalStore(
        cb => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        () => documentScroll,
      ),
  };
});

// 复刻 ScrollContainer：两种形态根节点不同，换形态时整棵 children 重挂，
// 且 ref 句柄在子组件布局 effect 之后才更新。
const Shell = ({
  viewportRef,
  children,
}: {
  viewportRef: React.RefObject<(() => HTMLElement | null) | null>;
  children: React.ReactNode;
}) => {
  const inner = useRef<HTMLDivElement>(null);
  const useDoc = useDocumentScroll();
  const doc = useDoc ? document.documentElement : null;
  React.useImperativeHandle(viewportRef as never, () => () => (useDoc ? doc : inner.current), [useDoc, doc]);
  return useDoc ? <div>{children}</div> : <section ref={inner}>{children}</section>;
};

let seen: (HTMLElement | null)[] = [];
const Child = ({ getRef }: { getRef: React.RefObject<(() => HTMLElement | null) | null> }) => {
  const el = useScrollElement(() => getRef.current?.() ?? null);
  seen.push(el);
  return null;
};

const App = () => {
  const getRef = useRef<(() => HTMLElement | null) | null>(null);
  return (
    <Shell viewportRef={getRef}>
      <Child getRef={getRef} />
    </Shell>
  );
};

describe("useScrollElement", () => {
  let host: HTMLDivElement;
  let root: Root;

  const flip = async (next: boolean) => {
    documentScroll = next;
    await act(async () => {
      listeners.forEach(cb => cb());
    });
  };

  beforeEach(() => {
    documentScroll = false;
    seen = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    listeners.clear();
  });

  it("形态切换导致列表重挂后，仍能解析到当前形态的滚动元素", async () => {
    await act(async () => root.render(<App />));
    expect(seen.at(-1)).toBe(host.querySelector("section"));

    await flip(true);
    expect(seen.at(-1)).toBe(document.documentElement);

    await flip(false);
    expect(seen.at(-1)).toBe(host.querySelector("section"));
    expect(seen.at(-1)?.isConnected).toBe(true);
  });
});
