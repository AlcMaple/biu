import { BrowserWindow, ipcMain } from "electron";

import { createDesktopLyricsWindow, destroyDesktopLyricsWindow, isDesktopLyricsVisible } from "../desktop-lyrics";
import { createMiniPlayer, destroyMiniPlayer, miniPlayer } from "../mini-player";
import { channel } from "./channel";

export function registerWindowHandlers({ getMainWindow }) {
  ipcMain.on(channel.window.minimize, event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.on(channel.window.toggleMaximize, event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.on(channel.window.close, event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  ipcMain.handle(channel.window.isMaximized, event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isMaximized() ?? false;
  });

  ipcMain.handle(channel.window.isFullScreen, event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isFullScreen() ?? false;
  });

  ipcMain.handle(channel.window.toggleMini, () => {
    const mainWindow = getMainWindow?.();
    if (miniPlayer && !miniPlayer.isDestroyed()) {
      destroyMiniPlayer();
      mainWindow?.show();
    } else {
      mainWindow?.hide();
      createMiniPlayer();
    }
  });

  ipcMain.on(channel.window.toggleDevTools, event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.webContents.toggleDevTools();
  });

  ipcMain.on(channel.window.desktopLyricsSetIgnoreMouseEvents, (event, ignore: boolean, options?: object) => {
    BrowserWindow.fromWebContents(event.sender)?.setIgnoreMouseEvents(ignore, options);
  });

  ipcMain.handle(channel.window.desktopLyricsGetBounds, event => {
    return BrowserWindow.fromWebContents(event.sender)?.getBounds() ?? null;
  });

  ipcMain.handle(channel.window.desktopLyricsSetBounds, (event, bounds: Partial<Electron.Rectangle>) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const current = win.getBounds();
    const next = { ...current, ...bounds };
    // enforce minimum size
    next.width = Math.max(next.width, 300);
    next.height = Math.max(next.height, 80);
    win.setBounds(next);
  });

  ipcMain.handle(channel.window.toggleDesktopLyrics, () => {
    if (isDesktopLyricsVisible()) {
      destroyDesktopLyricsWindow();
      getMainWindow()?.webContents.send(channel.window.desktopLyricsVisibilityChanged, false);
      return false;
    } else {
      createDesktopLyricsWindow(() => {
        // 窗口被用户从内部关闭时通知主窗口
        getMainWindow()?.webContents.send(channel.window.desktopLyricsVisibilityChanged, false);
      });
      return true;
    }
  });
}
