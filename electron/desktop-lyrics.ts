import { BrowserWindow, screen } from "electron";
import isDev from "electron-is-dev";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let desktopLyricsWindow: BrowserWindow | null = null;
let onClosedCallback: (() => void) | null = null;

export function createDesktopLyricsWindow(onClosed?: () => void): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = Math.min(900, width - 100);

  desktopLyricsWindow = new BrowserWindow({
    title: "Biu Desktop Lyrics",
    // ★ show: false + 后面用 showInactive() 显示，避免初次显示时抢焦点。
    // show: true 会在创建时触发激活，可能在 LOL 启动瞬间打断它的全屏独占。
    show: false,
    width: winWidth,
    height: 160,
    x: Math.round((width - winWidth) / 2),
    y: height - 140,
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
    desktopLyricsWindow = null;
    onClosedCallback?.();
    onClosedCallback = null;
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
    desktopLyricsWindow.destroy();
  }
  desktopLyricsWindow = null;
}

export function isDesktopLyricsVisible(): boolean {
  return Boolean(desktopLyricsWindow && !desktopLyricsWindow.isDestroyed());
}

export { desktopLyricsWindow };
