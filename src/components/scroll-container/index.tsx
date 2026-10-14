import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { Button } from "@heroui/react";
import { RiArrowUpSLine } from "@remixicon/react";
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentProps,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react";

import { useDocumentScroll } from "@/common/hooks/use-document-scroll";
import { isWeb } from "@/platform";

/**
 * 触屏设备（手机 / 平板）：滑动时浏览器工具栏收放会让视口高度逐帧变化，自定义滚动条的手柄随之
 * 不停重算、闪烁；触屏本来也不需要常驻的滚动条，所以直接不显示。
 */
const isTouchPrimary =
  typeof window !== "undefined" && window.matchMedia?.("(hover: none) and (pointer: coarse)").matches === true;

export interface ScrollRefObject {
  getViewport: () => HTMLElement | null;
}

const ScrollContainer = ({
  ref,
  options,
  children,
  resetOnChange,
  enableBackToTop,
  pageScroll,
  className,
  ...props
}: Omit<OverlayScrollbarsComponentProps, "ref"> & {
  ref?: React.RefObject<ScrollRefObject | null>;
  /** 当该值发生变化时，重置滚动条到顶部（用于切换路由 id、tab 等场景） */
  resetOnChange?: unknown;
  /** 是否监听滚动并显示返回顶部按钮 */
  enableBackToTop?: boolean;
  /** 页面主滚动区：手机网页上交给根文档滚动，见 useDocumentScroll */
  pageScroll?: boolean;
}) => {
  const osRef = useRef<OverlayScrollbarsComponentRef<"div"> | null>(null);
  const useDocument = useDocumentScroll() && pageScroll === true;
  const [showBackToTop, setShowBackToTop] = useState(false);
  const customScrollbars = options && typeof options === "object" ? options.scrollbars : undefined;

  const getViewport = useCallback(
    () =>
      useDocument
        ? (document.scrollingElement as HTMLElement | null)
        : ((osRef.current?.osInstance()?.elements().viewport as HTMLElement | undefined) ?? null),
    [useDocument],
  );

  useImperativeHandle(ref, () => ({ getViewport }), [getViewport]);

  useEffect(() => {
    if (resetOnChange === undefined) return;
    const viewport = getViewport();
    if (viewport) {
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
      setShowBackToTop(false);
    }
  }, [resetOnChange, getViewport]);

  useEffect(() => {
    if (!useDocument || !enableBackToTop) return;
    const handler = () => setShowBackToTop(window.scrollY > 400);
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [useDocument, enableBackToTop]);

  const handleBackToTop = () => {
    const viewport = getViewport();

    if (!viewport) return;

    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      viewport.scrollTop = 0;
    }
  };

  const backToTop = enableBackToTop && showBackToTop && (
    <Button
      as="div"
      isIconOnly
      type="button"
      radius="full"
      variant="flat"
      onPress={handleBackToTop}
      aria-label="返回顶部"
      className="bg-default/50 fixed right-10 bottom-[120px] z-20 shadow-xl shadow-black/30"
    >
      <RiArrowUpSLine size={20} />
    </Button>
  );

  if (useDocument) {
    // 高度类（h-full）在根文档滚动下没有意义，内容按自身高度撑开。
    return (
      <div className={className}>
        {children}
        {backToTop}
      </div>
    );
  }

  return (
    <OverlayScrollbarsComponent
      ref={osRef}
      className={className}
      options={{
        overflow: { x: "hidden" },
        ...options,
        scrollbars: {
          autoHide: "leave",
          autoHideDelay: 800,
          theme: "os-theme-light",
          ...customScrollbars,
          ...(isWeb ? { autoHide: "never" as const } : {}),
          ...(isTouchPrimary ? { visibility: "hidden" as const } : {}),
        },
      }}
      events={{
        scroll: instance => {
          if (!enableBackToTop) {
            setShowBackToTop(false);
            return;
          }
          const viewport = instance.elements().viewport as HTMLElement | null;
          setShowBackToTop((viewport?.scrollTop ?? 0) > 400);
        },
      }}
      {...props}
    >
      <>
        {children}
        {backToTop}
      </>
    </OverlayScrollbarsComponent>
  );
};

export default ScrollContainer;
