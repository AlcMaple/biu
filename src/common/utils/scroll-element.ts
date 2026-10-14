import type { Virtualizer } from "@tanstack/react-virtual";

import { observeElementOffset, observeElementRect } from "@tanstack/react-virtual";

export const isDocumentScroller = (el: Element | null | undefined) => !!el && el === document.scrollingElement;

// 根文档的 scroll 事件派发在 window 上，不在 documentElement 上。
export const scrollEventTarget = (el: HTMLElement): HTMLElement | Window => (isDocumentScroller(el) ? window : el);

// 根文档的 getBoundingClientRect().top 是 -scrollY，算相对偏移时它的「顶」应当是视口顶 0。
export const scrollerViewportTop = (el: HTMLElement) => (isDocumentScroller(el) ? 0 : el.getBoundingClientRect().top);

// 根文档的可视高度是视口高度，不是 documentElement 的内容高度。
export const scrollerClientHeight = (el: HTMLElement) =>
  isDocumentScroller(el) ? window.innerHeight : el.clientHeight;

const SCROLL_IDLE_DELAY = 150;

// tanstack-virtual 的默认观察器按「元素滚动」实现，遇到根文档要改听 window。
export const observeScrollerRect = <T extends Element>(
  instance: Virtualizer<HTMLElement, T>,
  cb: (rect: { width: number; height: number }) => void,
) => {
  if (!isDocumentScroller(instance.scrollElement)) return observeElementRect(instance, cb);
  const handler = () => cb({ width: window.innerWidth, height: window.innerHeight });
  handler();
  window.addEventListener("resize", handler, { passive: true });
  return () => window.removeEventListener("resize", handler);
};

export const observeScrollerOffset = <T extends Element>(
  instance: Virtualizer<HTMLElement, T>,
  cb: (offset: number, isScrolling: boolean) => void,
) => {
  if (!isDocumentScroller(instance.scrollElement)) return observeElementOffset(instance, cb);
  let timer = 0;
  const handler = () => {
    cb(window.scrollY, true);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => cb(window.scrollY, false), SCROLL_IDLE_DELAY);
  };
  cb(window.scrollY, false);
  window.addEventListener("scroll", handler, { passive: true });
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("scroll", handler);
  };
};

export const scrollerObservers = {
  observeElementRect: observeScrollerRect,
  observeElementOffset: observeScrollerOffset,
};
