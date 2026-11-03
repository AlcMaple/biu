import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useDocumentScroll } from "@/common/hooks/use-document-scroll";

const MAX_RETRY_FRAMES = 60;

// 手机横屏会越过 767px 断点，ScrollContainer 在「根文档滚动」与「内层滚动容器」之间换根节点，整棵列表随之重挂。
// 子组件的布局 effect 先于 ScrollContainer 暴露新的 getViewport 执行，此刻读到的是上一形态遗留的（已脱离文档的）
// 元素或 null；虚拟列表把它当滚动元素后没有任何后续渲染来纠正，竖屏回来就是一片空白。
// 所以滚动元素必须在所有布局 effect 之后（passive effect）再取，并在形态切换时重新取。
export function useScrollElement(getScrollElement: () => HTMLElement | null) {
  const documentScroll = useDocumentScroll();
  const getRef = useRef(getScrollElement);
  const [element, setElement] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    getRef.current = getScrollElement;
  });

  useEffect(() => {
    let raf = 0;
    let tries = 0;
    const resolve = () => {
      const next = getRef.current();
      setElement(next);
      // OverlayScrollbars 的 viewport 在挂载后才就绪
      if (!next && tries++ < MAX_RETRY_FRAMES) raf = requestAnimationFrame(resolve);
    };
    resolve();
    return () => cancelAnimationFrame(raf);
  }, [documentScroll]);

  return element;
}
