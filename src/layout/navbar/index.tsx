import React, { useState } from "react";

import { Button } from "@heroui/react";
import { RiMenuLine } from "@remixicon/react";
import clx from "classnames";

import ShazamModal from "@/components/shazam-modal";
import platform, { isAndroid } from "@/platform";
import { useUser } from "@/store/user";

import WindowAction from "../../components/window-action";
import { useSideDrawer } from "../side-drawer-context";
import AppUpdateNotify from "./app-update";
import Dev from "./dev";
import Navigation from "./navigation";
import Search from "./search";
import UserCard from "./user";
import UserFeed from "./user-feed";

const appPlatform = platform.getPlatform();

const LayoutNavbar = () => {
  const user = useUser(s => s.user);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const sideDrawer = useSideDrawer();

  const isNoDrag = isSearchFocused || isUserDropdownOpen;

  if (isAndroid) {
    return (
      <div className="flex h-full items-center gap-2 px-2">
        <Button isIconOnly variant="light" size="sm" aria-label="打开菜单" onPress={() => sideDrawer?.openSideDrawer()}>
          <RiMenuLine size={20} />
        </Button>
        <div className="min-w-0 flex-1">
          <Search onFocusChange={setIsSearchFocused} />
        </div>
        <UserCard onDropdownOpenChange={setIsUserDropdownOpen} />
      </div>
    );
  }

  return (
    <div
      className={clx("flex h-full items-center justify-between pr-2 pl-4", {
        "window-drag": !isNoDrag,
        "window-no-drag": isNoDrag,
      })}
    >
      <div className="window-no-drag flex items-center justify-start space-x-2">
        <Navigation />
        <Search onFocusChange={setIsSearchFocused} />
      </div>
      <div className="window-no-drag flex items-center justify-center space-x-4">
        <ShazamModal />
        <AppUpdateNotify />
        <Dev />
        {Boolean(user?.isLogin) && <UserFeed />}
        <UserCard onDropdownOpenChange={setIsUserDropdownOpen} />
        {["linux", "windows"].includes(appPlatform) && <WindowAction />}
      </div>
    </div>
  );
};

export default LayoutNavbar;
