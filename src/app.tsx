import { useEffect } from "react";
import { useHref, useNavigate, useRoutes } from "react-router";

import { HeroUIProvider, ToastProvider } from "@heroui/react";
import moment from "moment";

import platform, { isAndroid } from "@/platform";

import { getCookitFromBSite } from "./common/utils/cookie";
import {
  blurActiveNonEditableElement,
  createPointerFocusGuard,
  isEditableElement,
  shouldHandleSpaceAsPlayback,
} from "./common/utils/focus";
import { toggleMiniMode } from "./common/utils/mini-player";
import { mapKeyToElectronAccelerator } from "./common/utils/shortcut";
import Theme from "./components/theme";
import AndroidApp from "./pages/android";
import routes from "./routes";
import { useAppUpdateStore } from "./store/app-update";
import { usePlayList } from "./store/play-list";
import { usePlayProgress } from "./store/play-progress";
import { useShortcutSettings } from "./store/shortcuts";

import "moment/locale/zh-cn";

import "overlayscrollbars/overlayscrollbars.css";
import "./app.css";

moment.locale("zh-cn");

/**
 * 顶层 App 仅做平台分叉。Electron / Android 两套 shell 几乎完全独立
 * （路由树、布局、主进程依赖、快捷键监听），混在同一个组件里会让
 * Hooks 列表在两端都跑一遍 — 无意义且维护成本高。早返分叉到位后，
 * 各端 useEffect 各自独立。
 */
export function App() {
  if (isAndroid) return <AndroidApp />;
  return <ElectronApp />;
}

function ElectronApp() {
  const routeElement = useRoutes(routes);
  const navigate = useNavigate();
  const setUpdate = useAppUpdateStore(s => s.setUpdate);

  useEffect(() => {
    getCookitFromBSite();
  }, []);

  useEffect(() => {
    if (platform && platform.navigate) {
      const removeListener = platform.navigate(path => navigate(path));
      return removeListener;
    }
  }, [navigate]);

  // 订阅来自主进程的任务栏缩略按钮命令
  useEffect(() => {
    if (platform && platform.onPlayerCommand) {
      const removeListener = platform.onPlayerCommand(cmd => {
        const { prev, next, togglePlay } = usePlayList.getState();
        if (cmd === "prev") {
          prev();
        } else if (cmd === "next") {
          next();
        } else if (cmd === "toggle") {
          togglePlay();
        }
      });
      return removeListener;
    }
  }, []);

  // 订阅来自主进程的全局快捷键命令
  useEffect(() => {
    if (platform && platform.onShortcutCommand) {
      return platform.onShortcutCommand(cmd => {
        const { prev, next, togglePlay, setVolume, volume } = usePlayList.getState();

        switch (cmd) {
          case "togglePlay":
            togglePlay();
            break;
          case "prev":
            prev();
            break;
          case "next":
            next();
            break;
          case "volumeUp":
            setVolume(Math.min(1, volume + 0.05));
            break;
          case "volumeDown":
            setVolume(Math.max(0, volume - 0.05));
            break;
          case "toggleMiniMode":
            toggleMiniMode();
            break;
          default:
            break;
        }
      });
    }
  }, []);

  // 监听应用内快捷键
  // 窗口重新激活时，将焦点从按钮等交互元素上移走，避免空格触发上次操作
  useEffect(() => {
    const handleWindowFocus = () => {
      blurActiveNonEditableElement();
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, []);

  useEffect(() => {
    const pointerFocusGuard = createPointerFocusGuard();

    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略表单控件和富文本编辑区中的按键
      if (isEditableElement(e.target)) return;

      const shortcut = mapKeyToElectronAccelerator(e);
      if (!shortcut) return;

      const { shortcuts } = useShortcutSettings.getState();
      const matched = shortcuts.find(s => s.shortcut === shortcut);

      const releasedPointerFocus = pointerFocusGuard.releaseForKeyDown(e, Boolean(matched));

      // 空格是持续可用的播放器级播放 / 暂停键：鼠标遗留焦点只负责判断来源，
      // 释放到 body 后继续按空格仍会在播放和暂停之间切换。
      if (!matched && shouldHandleSpaceAsPlayback(e, releasedPointerFocus)) {
        e.preventDefault();
        usePlayList.getState().togglePlay();
        return;
      }

      // 回车不是播放器快捷键；释放鼠标焦点后补回原控件的一次原生激活。
      if (!matched && releasedPointerFocus && e.key === "Enter") {
        e.preventDefault();
        releasedPointerFocus.click();
        return;
      }

      if (matched) {
        e.preventDefault();
        const { prev, next, togglePlay, setVolume, volume } = usePlayList.getState();
        switch (matched.id) {
          case "togglePlay":
            togglePlay();
            break;
          case "prev":
            prev();
            break;
          case "next":
            next();
            break;
          case "volumeUp":
            setVolume(Math.min(1, volume + 0.05));
            break;
          case "volumeDown":
            setVolume(Math.max(0, volume - 0.05));
            break;
          case "toggleMiniMode":
            toggleMiniMode();
            break;
          default:
            break;
        }
      }
    };

    window.addEventListener("pointerdown", pointerFocusGuard.handlePointerDown, true);
    window.addEventListener("pointerup", pointerFocusGuard.handlePointerEnd, true);
    window.addEventListener("pointercancel", pointerFocusGuard.handlePointerEnd, true);
    window.addEventListener("focusin", pointerFocusGuard.handleFocusIn, true);
    // capture 阶段先于 React Aria 的按键处理，避免鼠标遗留焦点被切成 focus-visible。
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", pointerFocusGuard.handlePointerDown, true);
      window.removeEventListener("pointerup", pointerFocusGuard.handlePointerEnd, true);
      window.removeEventListener("pointercancel", pointerFocusGuard.handlePointerEnd, true);
      window.removeEventListener("focusin", pointerFocusGuard.handleFocusIn, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  useEffect(() => {
    const removeListener = platform.onUpdateAvailable(updateInfo => {
      setUpdate({
        isUpdateAvailable: true,
        latestVersion: updateInfo.latestVersion,
        releaseNotes: updateInfo.releaseNotes,
      });
    });

    return () => {
      removeListener();
    };
  }, [setUpdate]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (usePlayProgress.getState().currentTime) {
        usePlayProgress.getState().saveCurrentTime();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    // 清理函数
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return (
    <HeroUIProvider navigate={navigate} useHref={useHref} locale="zh-CN">
      <ToastProvider
        placement="bottom-right"
        toastOffset={90}
        maxVisibleToasts={3}
        toastProps={{ timeout: 2000, color: "primary" }}
        regionProps={{
          classNames: {
            base: "z-[99999]",
          },
        }}
      />
      <Theme>{routeElement}</Theme>
    </HeroUIProvider>
  );
}
