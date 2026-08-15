import React, { useEffect } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Outlet, useLocation } from "react-router";

import { useDisclosure } from "@heroui/react";

import ConfirmModal from "@/components/confirm-modal";
import Fallback from "@/components/error-fallback";
import FavoritesSelectModal from "@/components/favorites-select-modal";
import FullScreenPlayer from "@/components/full-screen-player";
import LyricsBroadcaster from "@/components/lyrics/broadcaster";
import PlayListDrawer from "@/components/music-playlist-drawer";
import ReleaseNoteModal from "@/components/release-note-modal";
import VideoPagesDownloadSelectModal from "@/components/video-pages-download-select-modal";
import PlayBar from "@/layout/playbar";
import { isNativeMobile, isWeb, log } from "@/platform";
import { initLocalPlaylistSync } from "@/service/sync";
import { useUser } from "@/store/user";

import Navbar from "./navbar";
import SideNav from "./side";
import { SideDrawerContext } from "./side-drawer-context";

const Layout = () => {
  const updateUser = useUser(state => state.updateUser);
  const location = useLocation();

  const { isOpen: isSideDrawerOpen, onOpen: openSideDrawer, onOpenChange: onSideDrawerOpenChange } = useDisclosure();

  useEffect(() => {
    void updateUser().catch(error => {
      log.warn("[startup] 更新用户信息失败", error);
    });

    // Web 平台没有可供同步服务换取令牌的 B 站 Cookie，启动通知通道只会形成空重连循环。
    // Electron 与 Capacitor 原生端均具备 Cookie 能力，继续保留本地歌单跨设备同步。
    if (!isWeb) initLocalPlaylistSync();
  }, [updateUser]);

  return (
    <ErrorBoundary
      FallbackComponent={Fallback}
      resetKeys={[location.pathname]}
      onError={(error, info) => {
        log.error("[ErrorBoundary]", error, info);
      }}
    >
      <SideDrawerContext.Provider value={{ openSideDrawer }}>
        {isNativeMobile ? (
          <div className="flex h-full flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
            <div className="h-[calc(4rem+env(safe-area-inset-top))] w-full flex-none pt-[env(safe-area-inset-top)]">
              <Navbar />
            </div>
            <div className="min-h-0 w-full flex-1 overflow-hidden">
              <Outlet />
            </div>
            <div className="relative z-50 h-[calc(88px+env(safe-area-inset-bottom))] w-full flex-none pb-[env(safe-area-inset-bottom)] shadow-2xl">
              <PlayBar />
            </div>
            <SideNav isDrawerOpen={isSideDrawerOpen} onDrawerOpenChange={onSideDrawerOpenChange} />
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex min-h-0 w-full flex-1">
              <SideNav />
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="h-16 flex-none">
                  <Navbar />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <Outlet />
                </div>
              </div>
            </div>
            <div className="relative z-50 h-[88px] w-full flex-none shadow-2xl">
              <PlayBar />
            </div>
          </div>
        )}
      </SideDrawerContext.Provider>
      <FavoritesSelectModal />
      <ConfirmModal />
      <VideoPagesDownloadSelectModal />
      <ReleaseNoteModal />
      <PlayListDrawer />
      <FullScreenPlayer />
      <LyricsBroadcaster />
    </ErrorBoundary>
  );
};

export default Layout;
