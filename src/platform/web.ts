import type { Logger, Platform } from "./types";

const STORE_KEY_PREFIX = "biu:";

const noop = () => {};
const asyncNoop = async () => {};
const unsubscribe = () => noop;

const getStorage = (): Storage | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

async function webGetStore<N extends StoreName>(name: N): Promise<StoreDataMap[N] | undefined> {
  try {
    const value = getStorage()?.getItem(`${STORE_KEY_PREFIX}${String(name)}`);
    return value == null ? undefined : (JSON.parse(value) as StoreDataMap[N]);
  } catch (err) {
    console.error(`[web.getStore] ${String(name)}:`, err);
    return undefined;
  }
}

async function webSetStore<N extends StoreName>(name: N, value: StoreDataMap[N]): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) getStorage()?.setItem(`${STORE_KEY_PREFIX}${String(name)}`, serialized);
  } catch (err) {
    console.error(`[web.setStore] ${String(name)}:`, err);
  }
}

async function webClearStore(name: StoreName): Promise<void> {
  try {
    getStorage()?.removeItem(`${STORE_KEY_PREFIX}${String(name)}`);
  } catch (err) {
    console.error(`[web.clearStore] ${String(name)}:`, err);
  }
}

const getWebPlatform = (): AppPlatForm => {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macos";
  return "linux";
};

const platform: Platform = {
  getStore: webGetStore,
  setStore: webSetStore,
  clearStore: webClearStore,
  selectDirectory: async () => null,
  selectFile: async () => null,
  selectImages: async () => [],
  showFileInFolder: async () => false,
  openDirectory: async () => false,
  openExternal: async url => {
    try {
      const target = new URL(url, window.location.href);
      if (target.protocol !== "http:" && target.protocol !== "https:") return false;
      window.open(target.href, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return false;
    }
  },
  getFonts: async () => [],
  navigate: unsubscribe,
  getCookie: async () => undefined,
  setCookie: asyncNoop,
  searchNeteaseSongs: async () => ({}),
  getNeteaseSimilarSongs: async () => ({}),
  getNeteaseLyrics: async () => ({}),
  searchLrclibLyrics: async () => [],
  getPlatform: getWebPlatform,
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
  heartbeatDebugLog: async () => null,
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
