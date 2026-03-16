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
    show: true,
    width: winWidth,
    height: 120,
    x: Math.round((width - winWidth) / 2),
    y: height - 140,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
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

  // 在所有工作区和全屏模式下可见
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
