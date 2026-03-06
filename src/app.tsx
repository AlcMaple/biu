import { useEffect } from "react";
import { useHref, useNavigate, useRoutes } from "react-router";

import { HeroUIProvider, ToastProvider, addToast } from "@heroui/react";
import moment from "moment";

import { getCookitFromBSite } from "./common/utils/cookie";
import { toggleMiniMode } from "./common/utils/mini-player";
import { mapKeyToElectronAccelerator } from "./common/utils/shortcut";
import Theme from "./components/theme";
import routes from "./routes";
import { useAppUpdateStore } from "./store/app-update";
import { lyricsSyncCache } from "./store/lyrics-sync-cache";
import { usePlayList } from "./store/play-list";
import { usePlayProgress } from "./store/play-progress";
import { useShortcutSettings } from "./store/shortcuts";

import "moment/locale/zh-cn";

import "overlayscrollbars/overlayscrollbars.css";
import "./app.css";

moment.locale("zh-cn");

export function App() {
  const routeElement = useRoutes(routes);
  const navigate = useNavigate();
  const setUpdate = useAppUpdateStore(s => s.setUpdate);

  useEffect(() => {
    getCookitFromBSite();
  }, []);

  useEffect(() => {
    if (window.electron && window.electron.navigate) {
      const removeListener = window.electron.navigate(path => navigate(path));
      return removeListener;
    }
  }, [navigate]);

  // 订阅来自主进程的任务栏缩略按钮命令
  useEffect(() => {
    if (window.electron && window.electron.onPlayerCommand) {
      const removeListener = window.electron.onPlayerCommand(cmd => {
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
    if (window.electron && window.electron.onShortcutCommand) {
      return window.electron.onShortcutCommand(cmd => {
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
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        active !== document.body &&
        active.tagName !== "INPUT" &&
        active.tagName !== "TEXTAREA" &&
        !active.isContentEditable
      ) {
        active.blur();
      }
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略在输入框中的按键
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      const shortcut = mapKeyToElectronAccelerator(e);
      if (!shortcut) return;

      const { shortcuts } = useShortcutSettings.getState();
      const matched = shortcuts.find(s => s.shortcut === shortcut);

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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 全局监听歌词后台同步结果，完成后弹出通知
  useEffect(() => {
    return window.electron.onSyncLyricsWithWhisperXDone(({ syncedLrc, originalLrc, error }) => {
      if (error) {
        addToast({ title: `歌词同步失败: ${error}`, color: "danger", timeout: 6000 });
      } else if (syncedLrc) {
        lyricsSyncCache.set(originalLrc, syncedLrc);
        addToast({ title: "歌词时间轴同步完成，可在预览中查看", color: "success", timeout: 5000 });
      }
    });
  }, []);

  useEffect(() => {
    const removeListener = window.electron.onUpdateAvailable(updateInfo => {
      setUpdate({
        isUpdateAvailable: true,
        latestVersion: updateInfo.latestVersion,
        releaseNotes: updateInfo.releaseNotes,
      });
    });

    return () => {
      removeListener();
    };
  }, []);

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
