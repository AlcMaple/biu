import { BrowserWindow, screen } from "electron";
import isDev from "electron-is-dev";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { windowStateStore } from "./store";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let desktopLyricsWindow: BrowserWindow | null = null;
let onClosedCallback: (() => void) | null = null;
let saveBoundsTimer: NodeJS.Timeout | null = null;

function getInitialBounds(): Electron.Rectangle {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = Math.min(900, width - 100);
  const defaultBounds: Electron.Rectangle = {
    width: winWidth,
    height: 160,
    x: Math.round((width - winWidth) / 2),
    y: height - 140,
  };

  const saved = windowStateStore.get("desktopLyrics");
  if (!saved) return defaultBounds;

  // 校验保存的位置仍在某块显示器的工作区内（防止外接屏幕被移除后窗口落到不可见区域）
  const displays = screen.getAllDisplays();
  const visible = displays.some(d => {
    const a = d.workArea;
    return (
      saved.x + saved.width > a.x && saved.x < a.x + a.width && saved.y + saved.height > a.y && saved.y < a.y + a.height
    );
  });
  if (!visible) return defaultBounds;

  return {
    x: saved.x,
    y: saved.y,
    width: Math.max(saved.width, 300),
    height: Math.max(saved.height, 80),
  };
}

export function createDesktopLyricsWindow(onClosed?: () => void): BrowserWindow {
  const bounds = getInitialBounds();

  desktopLyricsWindow = new BrowserWindow({
    title: "Biu Desktop Lyrics",
    // ★ show: false + 后面用 showInactive() 显示，避免初次显示时抢焦点。
    // show: true 会在创建时触发激活，可能在 LOL 启动瞬间打断它的全屏独占。
    show: false,
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    // ★ 关键：构造时直接设 focusable: false（对应 Win32 WS_EX_NOACTIVATE）。
    // 必须在构造里设，setFocusable(false) 在窗口创建后调用有时机问题。
    // 窗口永远不可激活 → 不抢焦点 → 不触发前台切换 → 全屏游戏不被最小化。
    // 鼠标点击仍可工作，只是不能获得键盘焦点（桌面歌词本来就不需要）。
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      webSecurity: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev,
    },
  });

  // 仅 macOS 上一次性升级到 screen-saver 层级（Windows 所有非 normal 层级都
  // 映射到 HWND_TOPMOST，重复调用反而可能通知 DWM 干扰全屏游戏，所以 Windows
  // 不调，依赖构造里的 alwaysOnTop: true 即可）。
  if (process.platform === "darwin") {
    desktopLyricsWindow.setAlwaysOnTop(true, "screen-saver");
  }

  // 在所有工作区和全屏模式下可见（macOS only，Windows 上无副作用）
  desktopLyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  onClosedCallback = onClosed ?? null;
  desktopLyricsWindow.on("closed", () => {
    if (saveBoundsTimer) {
      clearTimeout(saveBoundsTimer);
      saveBoundsTimer = null;
    }
    desktopLyricsWindow = null;
    onClosedCallback?.();
    onClosedCallback = null;
  });

  // 拖动/缩放后持久化窗口位置；debounce 防止拖动过程中频繁写盘。
  // close 前再 flush 一次（destroy 时窗口已不可读 bounds，所以监听 close 而非 closed）。
  const scheduleSaveBounds = () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      saveBoundsTimer = null;
      if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
        windowStateStore.set("desktopLyrics", desktopLyricsWindow.getBounds());
      }
    }, 400);
  };
  desktopLyricsWindow.on("moved", scheduleSaveBounds);
  desktopLyricsWindow.on("resized", scheduleSaveBounds);
  desktopLyricsWindow.on("close", () => {
    if (saveBoundsTimer) {
      clearTimeout(saveBoundsTimer);
      saveBoundsTimer = null;
    }
    if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      windowStateStore.set("desktopLyrics", desktopLyricsWindow.getBounds());
    }
  });

  desktopLyricsWindow.webContents.on("before-input-event", (event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === "r") {
      event.preventDefault();
    }
  });

  if (process.platform === "win32") {
    desktopLyricsWindow.hookWindowMessage(0x0116, () => {
      desktopLyricsWindow?.setEnabled(false);
      setTimeout(() => desktopLyricsWindow?.setEnabled(true), 100);
      return true;
    });
  }

  const indexPath = path.resolve(__dirname, "../dist/web/index.html");
  desktopLyricsWindow.loadFile(indexPath, { hash: "desktop-lyrics" });

  // ★ 用 showInactive() 显示，不抢焦点。配合 focusable: false，桌面歌词从生命周期
  // 第一帧起就不会触发任何前台/激活变化，DirectX 全屏独占游戏不会被打断。
  desktopLyricsWindow.showInactive();

  return desktopLyricsWindow;
}

export function destroyDesktopLyricsWindow(): void {
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    // destroy() 不触发 close 事件，所以这里手动 flush 一次位置，
    // 避免「拖动后立刻关闭」时 debounce 还没落盘就被销毁。
    if (saveBoundsTimer) {
      clearTimeout(saveBoundsTimer);
      saveBoundsTimer = null;
    }
    windowStateStore.set("desktopLyrics", desktopLyricsWindow.getBounds());
    desktopLyricsWindow.destroy();
  }
  desktopLyricsWindow = null;
}

export function isDesktopLyricsVisible(): boolean {
  return Boolean(desktopLyricsWindow && !desktopLyricsWindow.isDestroyed());
}

export { desktopLyricsWindow };
