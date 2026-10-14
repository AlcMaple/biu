import { useIsMobileLayout } from "@/common/hooks/use-responsive";
import { isWeb } from "@/platform";

// 手机网页改由根文档滚动：iOS Chrome / Safari 只有根文档滚动时才会收放底部工具栏；
// 内层容器滚动时工具栏永远常驻，键盘弹出还会把按可见高度钉死的外壳整体压扁，播放栏顶到输入框上。
// 原生 App、桌面、平板没有这些问题，继续用内层滚动容器。
export function useDocumentScroll() {
  const isMobileLayout = useIsMobileLayout();
  return isWeb && isMobileLayout;
}
