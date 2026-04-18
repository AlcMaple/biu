import type { Logger, Platform } from "./types";

const noop = () => {};
const asyncNoop = async () => {};
const unsubscribe = () => noop;

const platform: Platform = {
  getStore: async () => undefined,
  setStore: asyncNoop,
  clearStore: asyncNoop,
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
  getCookie: async () => undefined,
  setCookie: asyncNoop,
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
