import React, { useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

import { Avatar, Button, Tooltip } from "@heroui/react";
import clx from "classnames";
import { twMerge } from "tailwind-merge";

export interface MenuItemProps {
  /** 菜单项标签 */
  title: string;
  /** 菜单项链接 */
  href?: string;
  /** 唯一标识，用于排序等场景 */
  id?: number | string;
  /** 菜单项图标 */
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  /** 封面 */
  cover?: string;
  /** 激活状态图标 */
  activeIcon?: React.ComponentType<{ size?: number | string; className?: string }>;
  className?: string;
  onPress?: VoidFunction;
  collapsed?: boolean;
  /** 用于 dnd-kit 等场景，把拖拽监听器绑定到可交互元素上 */
  dndProps?: ({ className?: string } & Record<string, unknown>) | undefined;
  [key: string]: unknown;
}

const MenuItem: React.FC<MenuItemProps> = ({
  title,
  href,
  cover,
  icon: Icon,
  activeIcon: ActiveIcon,
  className,
  onPress,
  collapsed,
  dndProps,
}) => {
  const location = useLocation();
  const navigate = useNavigate();

  const handlePress = () => {
    if (href) navigate(href);
    onPress?.();
  };

  // 精确匹配路径段：早期用 href.includes(routeId) 做子串匹配，当选中歌单 id 为短前缀
  // （如默认红心歌单 -1）时会命中所有以其为前缀的本地歌单 id（-1772…），导致全部误高亮。
  const isActive = useMemo(() => {
    if (!href) return false;
    return location.pathname === href.split("?")[0];
  }, [location.pathname, href]);

  const iconContent = useMemo(() => {
    const icon =
      isActive && ActiveIcon ? (
        <ActiveIcon size={18} className="text-primary" />
      ) : Icon ? (
        <Icon size={18} />
      ) : undefined;

    if (!collapsed && icon) {
      return icon;
    }

    return (
      <Avatar
        name={title}
        src={cover ? `${cover}@672w_378h_1c.avif` : undefined}
        showFallback
        radius="md"
        fallback={icon}
        alt={title}
        className="h-10 w-10 flex-none"
      />
    );
  }, [cover, isActive, Icon, ActiveIcon, title, collapsed]);

  const { className: dndClassName, ...dndRest } = (dndProps ?? {}) as {
    className?: string;
  } & Record<string, unknown>;

  if (collapsed) {
    return (
      <Tooltip closeDelay={0} content={title} placement="right" offset={-3}>
        <Button
          fullWidth
          variant={isActive ? "flat" : "light"}
          color={isActive ? "primary" : "default"}
          onPress={handlePress}
          className={clx("w-full min-w-0 justify-center rounded-md px-0 py-1", className, dndClassName, {
            "h-auto": collapsed,
            "text-primary": isActive,
          })}
          {...(dndRest as any)}
        >
          {iconContent}
        </Button>
      </Tooltip>
    );
  }

  return (
    <Button
      fullWidth
      disableRipple
      variant={isActive ? "flat" : "light"}
      color={isActive ? "primary" : "default"}
      onPress={handlePress}
      startContent={iconContent}
      className={twMerge("justify-start px-2 text-inherit", className, dndClassName)}
      {...(dndRest as any)}
    >
      <span className="pointer-events-none truncate">{title}</span>
    </Button>
  );
};

export default MenuItem;
