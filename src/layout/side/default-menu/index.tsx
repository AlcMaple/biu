import React, { useMemo } from "react";

import { RiApps2AddFill, RiApps2AddLine } from "@remixicon/react";

import { getDefaultMenuList } from "@/common/constants/menus";
import MenuGroup from "@/components/menu/menu-group";
import { isNativeMobile, isWeb } from "@/platform";
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

  const items = useMemo(() => {
    const filtered = getDefaultMenuList(isWeb)
      .filter(item => (item.needLogin ? user?.isLogin : true))
      .filter(item => item.href && !hiddenMenuKeys.includes(item.href))
      .filter(item => !(isNativeMobile && item.href && MOBILE_HIDDEN_HREFS.has(item.href)));

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
  }, [user?.isLogin, hiddenMenuKeys, isCollapsed, onOpenAddFavorite]);

  return <MenuGroup items={items} collapsed={isCollapsed} />;
};

export default DefaultMenus;
