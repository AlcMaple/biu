import { CapacitorCookies } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

import type { Logger, Platform } from "./types";

/**
 * B 站 cookie 域。所有读写都对准这个域，与 Electron 端
 * `electron/ipc/cookie.ts` 用 `.bilibili.com` 域保持一致。
 */
const BILIBILI_URL = "https://www.bilibili.com";

const noop = () => {};
const asyncNoop = async () => {};
const unsubscribe = () => noop;

/**
 * Android 端的 store 实现。每个 StoreName 对应一条 Capacitor Preferences 键值，
 * value 用 JSON 序列化保存。这是 Electron 端 electron-store 的对等实现，
 * 区别只是底层从 .json 文件换成了 Android SharedPreferences。
 *
 * 解锁的功能：token 持久化、本地歌单 / 本地收藏 / tag 持久化、应用设置 / 快捷键设置、
 * 歌词缓存 —— 之前因为 noop 全部用不了。
 */
const STORE_KEY_PREFIX = "biu:";

async function androidGetStore<N extends StoreName>(name: N): Promise<StoreDataMap[N] | undefined> {
  try {
    const { value } = await Preferences.get({ key: `${STORE_KEY_PREFIX}${name}` });
    if (!value) return undefined;
    return JSON.parse(value) as StoreDataMap[N];
  } catch (err) {
    console.error(`[android.getStore] ${String(name)}:`, err);
    return undefined;
  }
}

async function androidSetStore<N extends StoreName>(name: N, value: StoreDataMap[N]): Promise<void> {
  try {
    if (value === undefined || value === null) return;
    await Preferences.set({ key: `${STORE_KEY_PREFIX}${name}`, value: JSON.stringify(value) });
  } catch (err) {
    console.error(`[android.setStore] ${String(name)}:`, err);
  }
}

async function androidClearStore(name: StoreName): Promise<void> {
  try {
    await Preferences.remove({ key: `${STORE_KEY_PREFIX}${name}` });
  } catch (err) {
    console.error(`[android.clearStore] ${String(name)}:`, err);
  }
}

const platform: Platform = {
  getStore: androidGetStore,
  setStore: androidSetStore,
  clearStore: androidClearStore,
  selectDirectory: async () => null,
  selectFile: async () => null,
  selectImages: async () => [],
  showFileInFolder: async () => false,
  openDirectory: async () => false,
  openExternal: async url => {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return false;
    }
  },
  getFonts: async () => [],
  navigate: unsubscribe,
  /**
   * 读取 B 站域名下指定 cookie。CapacitorCookies.getCookies 返回 `{ key: value }` map，
   * 与 Electron 端 `session.cookies.get({ name, domain: ".bilibili.com" })` 行为对等。
   */
  getCookie: async (key: string) => {
    try {
      const cookies = await CapacitorCookies.getCookies({ url: BILIBILI_URL });
      return cookies?.[key];
    } catch (err) {
      console.error("[android.getCookie]", err);
      return undefined;
    }
  },
  /**
   * 写入 B 站域名下的 cookie。CapacitorCookies 在 Android 端会写入 WebView
   * 自带的系统 cookie jar（CookieManager），后续 fetch / CapacitorHttp 请求会自动带上。
   * expires 接收的是秒级时间戳，转成 RFC 1123 字符串塞给原生侧。
   */
  setCookie: async (name: string, value: string, expirationDate?: number) => {
    try {
      await CapacitorCookies.setCookie({
        url: BILIBILI_URL,
        key: name,
        value,
        expires: expirationDate ? new Date(expirationDate * 1000).toUTCString() : undefined,
      });
    } catch (err) {
      console.error("[android.setCookie]", err);
    }
  },
  searchNeteaseSongs: async () => ({}),
  getNeteaseLyrics: async () => ({}),
  searchLrclibLyrics: async () => [],
  getPlatform: () => "linux" as AppPlatForm,
  setProxySettings: asyncNoop,
  updatePlaybackState: noop,
  onShortcutCommand: unsubscribe,
  registerShortcut: async () => false,
  unregisterShortcut: asyncNoop,
  registerAllShortcuts: asyncNoop,
  unregisterAllShortcuts: asyncNoop,
  onPlayerCommand: unsubscribe,
  getAppVersion: async () => "",
  isDev: async () => false,
  isSupportAutoUpdate: () => false,
  checkAppUpdate: async () => ({}),
  onUpdateAvailable: unsubscribe,
  downloadAppUpdate: asyncNoop,
  onDownloadAppProgress: unsubscribe,
  quitAndInstall: asyncNoop,
  toggleMiniPlayer: asyncNoop,
  toggleDesktopLyrics: async () => false,
  onDesktopLyricsVisibilityChange: unsubscribe,
  setDesktopLyricsIgnoreMouseEvents: noop,
  getDesktopLyricsBounds: async () => null,
  setDesktopLyricsBounds: asyncNoop,
  getDesktopLyricsCursorRelative: async () => null,
  minimizeWindow: noop,
  toggleMaximizeWindow: noop,
  closeWindow: noop,
  isMaximized: async () => false,
  onWindowMaximizeChange: unsubscribe,
  isFullScreen: async () => false,
  onWindowFullScreenChange: unsubscribe,
  toggleDevTools: noop,
  getMediaDownloadTaskList: async () => [],
  syncMediaDownloadTaskList: unsubscribe,
  addMediaDownloadTask: asyncNoop,
  addMediaDownloadTaskList: asyncNoop,
  pauseMediaDownloadTask: asyncNoop,
  resumeMediaDownloadTask: asyncNoop,
  cancelMediaDownloadTask: asyncNoop,
  retryMediaDownloadTask: asyncNoop,
  clearMediaDownloadTaskList: asyncNoop,
  scanLocalMusic: async () => [],
  deleteLocalMusicFile: async () => false,
  peekFancyPlayerThumb: async () => null,
  readFancyPlayerSourceFile: async () => null,
  saveFancyPlayerThumb: async () => null,
  removeFancyPlayerThumb: async () => false,
  recognizeSong: async () => ({}),
  getDesktopSources: async () => [],
  requestMicPermission: async () => false,
  checkWhisperXDeps: async () => ({ ok: false }),
  installWhisperXDeps: async () => ({ ok: false }),
  startSyncLyricsWithWhisperX: noop,
  onSyncLyricsWithWhisperXDone: unsubscribe,
  onSyncLyricsWithWhisperXProgress: unsubscribe,
};

export const log: Logger = {
  error: (...args) => console.error(...args),
  warn: (...args) => console.warn(...args),
  info: (...args) => console.info(...args),
  debug: (...args) => console.debug(...args),
};

export default platform;
