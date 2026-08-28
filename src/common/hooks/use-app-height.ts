import { useEffect } from "react";

/**
 * 把「可见视口高度」写进 CSS 变量 `--app-h`，供根容器（html/body/#root）当高度用。
 *
 * 为什么不能只靠 CSS 的 100dvh：
 * - iOS **Chrome（CriOS）** 的底部工具栏是浮在页面之上的覆盖层，`100dvh` 并不会把它减掉，
 *   于是底部播放栏被工具栏挡住（竖屏尤其明显；横屏工具栏更矮才勉强露出）。Safari 会用
 *   safe-area 处理，Chrome iOS 不会，safe-area-inset-bottom 也只含 home indicator。
 * - `visualViewport.height` 给的是**真正可见**的高度（已扣掉当前显示的工具栏），旋转 / 工具栏
 *   收放时通过 resize 事件实时更新，跨 iOS 各浏览器都准。
 *
 * 桌面 / Electron / 网页 PC 没有动态工具栏，`visualViewport.height` 等于窗口高度，行为不变。
 * 拿不到 visualViewport 的老环境：不设变量，CSS 回退到 100dvh（见 app.css）。
 */
export function useAppHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const apply = () => {
      // visualViewport can briefly report 0 while a browser rotates; keep the
      // last usable CSS value instead of collapsing the whole app shell.
      if (vv.height > 0) {
        document.documentElement.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
      }
    };
    apply();

    // resize：工具栏收放 / 旋转 / 键盘弹出都会触发，高度变化都在这里
    vv.addEventListener("resize", apply);
    // 某些 iOS Chrome 版本把工具栏移动表现为 visualViewport 的 offset
    // 变化而不是单独的 resize；scroll 事件能覆盖这条路径。
    vv.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);
}
