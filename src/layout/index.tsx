import React, { useCallback, useEffect, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Outlet, useLocation } from "react-router";

import clx from "classnames";

import { useAppHeight } from "@/common/hooks/use-app-height";
import { useIsMobileLayout } from "@/common/hooks/use-responsive";
import ConfirmModal from "@/components/confirm-modal";
import Fallback from "@/components/error-fallback";
import FavoritesSelectModal from "@/components/favorites-select-modal";
import FullScreenPlayer from "@/components/full-screen-player";
import LyricsBroadcaster from "@/components/lyrics/broadcaster";
import PlayListDrawer from "@/components/music-playlist-drawer";
import ReleaseNoteModal from "@/components/release-note-modal";
import VideoPagesDownloadSelectModal from "@/components/video-pages-download-select-modal";
import PlayBar from "@/layout/playbar";
import { log } from "@/platform";
import { initLocalPlaylistSync } from "@/service/sync";
import { useUser } from "@/store/user";

import Navbar from "./navbar";
import SideNav from "./side";
import { SideDrawerContext } from "./side-drawer-context";

const Layout = () => {
  const updateUser = useUser(state => state.updateUser);
  const location = useLocation();
  const isMobileLayout = useIsMobileLayout();

  // 这里刻意不用 useDisclosure：它的 onOpenChange 是「切换」而不是按入参赋值，
  // 抽屉在断点切换时带着 open 状态卸载，会被那次回调反手切回 true —— 拉宽再拉窄就凭空弹出抽屉。
  const [isSideDrawerOpen, setSideDrawerOpen] = useState(false);
  const openSideDrawer = useCallback(() => setSideDrawerOpen(true), []);

  useEffect(() => {
    void updateUser().catch(error => {
      log.warn("[startup] 更新用户信息失败", error);
    });

    // Web 通过同源 BFF 在服务端换取同步权限；浏览器不接触 B 站 Cookie 或同步 JWT。
    initLocalPlaylistSync();
  }, [updateUser]);

  // 用可见视口高度钉住根容器高度，专治 iOS Chrome 底部工具栏遮住播放栏（详见 use-app-height）。
  // 放在启动同步之后，保持启动失败日志与同步初始化作为 Layout 的首个副作用。
  useAppHeight();

  // 抽屉只在移动形态下存在，离开该断点时要一并收掉状态。
  useEffect(() => {
    if (!isMobileLayout) setSideDrawerOpen(false);
  }, [isMobileLayout]);

  return (
    <ErrorBoundary
      FallbackComponent={Fallback}
      resetKeys={[location.pathname]}
      onError={(error, info) => {
        log.error("[ErrorBoundary]", error, info);
      }}
    >
      <SideDrawerContext.Provider value={{ openSideDrawer }}>
        {/*
         * 移动与桌面共用同一棵元素树：SideNav 在移动形态下渲染的是抽屉（Portal，不占布局），
         * 所以只需切换类名而不是切换两套 JSX。分成两棵树会让断点切换时 Outlet 整体重挂，
         * 已加载的歌曲列表和滚动位置都会丢失。
         */}
        <div
          className={clx("flex h-full flex-col", {
            "pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]": isMobileLayout,
          })}
        >
          <div className="flex min-h-0 w-full flex-1">
            <SideNav isDrawerOpen={isSideDrawerOpen} onDrawerOpenChange={setSideDrawerOpen} />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div
                className={clx("w-full flex-none", {
                  "h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)]": isMobileLayout,
                  "h-16": !isMobileLayout,
                })}
              >
                <Navbar />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <Outlet />
              </div>
            </div>
          </div>
          <div
            className={clx("relative z-50 w-full flex-none shadow-2xl", {
              "h-[calc(88px+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)]": isMobileLayout,
              "h-[88px]": !isMobileLayout,
            })}
          >
            <PlayBar />
          </div>
        </div>
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
