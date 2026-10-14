import React, { useCallback, useEffect, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Outlet, useLocation } from "react-router";

import clx from "classnames";

import { useAppHeight } from "@/common/hooks/use-app-height";
import { useDocumentScroll } from "@/common/hooks/use-document-scroll";
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
import { isWeb, log } from "@/platform";
import { initLocalPlaylistSync } from "@/service/sync";
import { useUser } from "@/store/user";

import Navbar from "./navbar";
import SideNav from "./side";
import { SideDrawerContext } from "./side-drawer-context";

const Layout = () => {
  const updateUser = useUser(state => state.updateUser);
  const location = useLocation();
  const isMobileLayout = useIsMobileLayout();
  const documentScroll = useDocumentScroll();

  // 这里刻意不用 useDisclosure：它的 onOpenChange 是「切换」而不是按入参赋值，
  // 抽屉在断点切换时带着 open 状态卸载，会被那次回调反手切回 true —— 拉宽再拉窄就凭空弹出抽屉。
  const [isSideDrawerOpen, setSideDrawerOpen] = useState(false);
  const openSideDrawer = useCallback(() => setSideDrawerOpen(true), []);
  const closeSideDrawer = useCallback(() => setSideDrawerOpen(false), []);

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

  useEffect(() => {
    const root = document.documentElement;
    if (documentScroll) root.dataset.scroll = "document";
    else delete root.dataset.scroll;
  }, [documentScroll]);

  // 根文档滚动时各页面不再有自己的滚动容器，换路由要手动回到页首。
  useEffect(() => {
    if (documentScroll) window.scrollTo(0, 0);
  }, [documentScroll, location.pathname]);

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
        if (isWeb) window.__biuMonitoring?.captureException(error, info.componentStack ?? undefined);
      }}
    >
      <SideDrawerContext.Provider value={{ openSideDrawer, closeSideDrawer }}>
        {/*
         * 移动与桌面共用同一棵元素树：SideNav 在移动形态下渲染的是抽屉（Portal，不占布局），
         * 所以只需切换类名而不是切换两套 JSX。分成两棵树会让断点切换时 Outlet 整体重挂，
         * 已加载的歌曲列表和滚动位置都会丢失。
         */}
        <div
          className={clx("flex flex-col", {
            "h-full": !documentScroll,
            "pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]": isMobileLayout,
          })}
        >
          <div className={clx("flex w-full flex-1", { "min-h-0": !documentScroll })}>
            <SideNav isDrawerOpen={isSideDrawerOpen} onDrawerOpenChange={setSideDrawerOpen} />
            <div className={clx("flex min-w-0 flex-1 flex-col", { "min-h-0": !documentScroll })}>
              <div
                className={clx("w-full flex-none", {
                  "bg-background sticky top-0 z-40": documentScroll,
                  "h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)]": isMobileLayout,
                  "h-16": !isMobileLayout,
                })}
              >
                <Navbar />
              </div>
              {/* 根文档滚动时播放栏是 fixed 的，底部留出它的常量高度，最后一行才能滚到它上面 */}
              <div
                className={clx("flex-1", {
                  "min-h-0 overflow-hidden": !documentScroll,
                  "pb-[calc(88px+var(--safe-bottom)+12px)]": documentScroll,
                })}
              >
                <Outlet />
              </div>
            </div>
          </div>
          <div
            className={clx("z-50 w-full flex-none shadow-2xl", {
              relative: !documentScroll,
              // 尺寸只用常量（--safe-bottom 在浏览器标签页里是常量，见 app.css），fixed 元素尺寸逐帧变化就会抖。
              "bg-background fixed inset-x-0 bottom-0": documentScroll,
              "h-[calc(88px+var(--safe-bottom))]": isMobileLayout,
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
