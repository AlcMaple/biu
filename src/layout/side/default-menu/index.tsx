import React, { useEffect, useMemo } from "react";

import { RiApps2AddFill, RiApps2AddLine } from "@remixicon/react";

import { getDefaultMenuList } from "@/common/constants/menus";
import MenuGroup from "@/components/menu/menu-group";
import { isNativeMobile, isWeb } from "@/platform";
import { refreshAlignReviewOnFocus, useAlignReview } from "@/store/align-review";
import { useSettings } from "@/store/settings";
import { useUser } from "@/store/user";

const MOBILE_HIDDEN_HREFS = new Set(["/download-list"]);

interface Props {
  isCollapsed?: boolean;
  onOpenAddFavorite?: () => void;
}

const DefaultMenus = ({ isCollapsed, onOpenAddFavorite }: Props) => {
  const user = useUser(state => state.user);
  const hiddenMenuKeys = useSettings(state => state.hiddenMenuKeys);
  const isReviewer = useAlignReview(state => state.isAdmin);
  const pendingReviews = useAlignReview(state => state.pendingCount);

  // 审核员身份由对齐服务按登录账号判定，换号 / 退出都要重新查
  useEffect(() => {
    if (user?.isLogin) void useAlignReview.getState().refresh();
    else useAlignReview.getState().reset();
  }, [user?.isLogin, user?.mid]);

  // 别人新提交的歌词要在审核员切回窗口时就能看到数量变化，不必重启或先点进审核页
  useEffect(() => {
    if (!user?.isLogin) return;
    const onVisible = () => document.visibilityState === "visible" && refreshAlignReviewOnFocus();
    window.addEventListener("focus", refreshAlignReviewOnFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refreshAlignReviewOnFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.isLogin]);

  const items = useMemo(() => {
    const filtered = getDefaultMenuList(isWeb)
      .filter(item => (item.needLogin ? user?.isLogin : true))
      .filter(item => (item.needReviewer ? isReviewer : true))
      .filter(item => item.href && !hiddenMenuKeys.includes(item.href))
      .filter(item => !(isNativeMobile && item.href && MOBILE_HIDDEN_HREFS.has(item.href)))
      .map(item => (item.needReviewer ? { ...item, badge: pendingReviews } : item));

    // 展开态的「新建收藏夹」在收藏夹分组的标题栏里，而该分组未登录时整个不渲染；
    // 折叠轨把这个入口提到菜单里，同样要跟着登录态走，否则未登录也会多出一个按钮。
    if (isCollapsed && user?.isLogin) {
      return [
        ...filtered,
        {
          title: "创建收藏夹",
          icon: RiApps2AddLine,
          activeIcon: RiApps2AddFill,
          onPress: onOpenAddFavorite,
        },
      ];
    }

    return filtered;
  }, [user?.isLogin, hiddenMenuKeys, isCollapsed, onOpenAddFavorite, isReviewer, pendingReviews]);

  return <MenuGroup items={items} collapsed={isCollapsed} />;
};

export default DefaultMenus;
