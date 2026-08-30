import { isOfflineDemo } from "@/common/offline-demo";
import { getWebNeteaseLyrics, searchWebLrclibLyrics, searchWebNeteaseSongs } from "@/service/web-lyrics";
import { StoreNameMap } from "@shared/store";

import type { Logger, Platform } from "./types";

import { installWebLogTransport, reportWebLog } from "./web-log-transport";

const STORE_KEY_PREFIX = isOfflineDemo ? "biu-demo:" : "biu:";
const WEB_STORE_DATABASE = isOfflineDemo ? "biu-demo-web-store" : "biu-web-store";
const WEB_STORE_OBJECT_STORE = "stores";

// 歌单、同步基线与滚动备份会随用户数据增长；localStorage 的同步配额不适合承载它们。
// 轻量设置保留 localStorage，以避免扩大迁移面。
const highCapacityStores = new Set<StoreName>([
  StoreNameMap.LocalFavorites,
  StoreNameMap.LocalFavItems,
  StoreNameMap.Tags,
  StoreNameMap.PlaylistSyncMeta,
  StoreNameMap.PlaylistSyncBackups,
]);

let databasePromise: Promise<IDBDatabase | undefined> | undefined;

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

const storageKey = (name: StoreName) => `${STORE_KEY_PREFIX}${String(name)}`;

function openDatabase(): Promise<IDBDatabase | undefined> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);

  databasePromise = new Promise(resolve => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(WEB_STORE_DATABASE, 1);
    } catch (err) {
      console.error("[web.store] IndexedDB unavailable:", err);
      resolve(undefined);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(WEB_STORE_OBJECT_STORE)) {
        request.result.createObjectStore(WEB_STORE_OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.error("[web.store] IndexedDB open failed:", request.error);
      resolve(undefined);
    };
    request.onblocked = () => {
      console.warn("[web.store] IndexedDB upgrade is blocked by another tab");
      resolve(undefined);
    };
  });
  return databasePromise;
}

function readIndexedValue<T>(database: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WEB_STORE_OBJECT_STORE, "readonly");
    const request = transaction.objectStore(WEB_STORE_OBJECT_STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function writeIndexedValue(database: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WEB_STORE_OBJECT_STORE, "readwrite");
    transaction.objectStore(WEB_STORE_OBJECT_STORE).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function readLegacyStore<N extends StoreName>(name: N): StoreDataMap[N] | undefined {
  const value = getStorage()?.getItem(storageKey(name));
  return value == null ? undefined : (JSON.parse(value) as StoreDataMap[N]);
}

async function webGetStore<N extends StoreName>(name: N): Promise<StoreDataMap[N] | undefined> {
  if (isOfflineDemo) {
    const { DEMO_STORE_DATA } = await import("@/common/offline-demo-fixtures");
    const demoStores: Partial<Record<StoreName, unknown>> = {
      [StoreNameMap.AppSettings]: { appSettings: DEMO_STORE_DATA.appSettings },
      [StoreNameMap.UserLoginInfo]: DEMO_STORE_DATA.user,
      [StoreNameMap.LocalFavorites]: DEMO_STORE_DATA.favorites,
      [StoreNameMap.LocalFavItems]: DEMO_STORE_DATA.localFavItems,
      [StoreNameMap.Tags]: DEMO_STORE_DATA.tags,
    };
    const seeded = demoStores[name];
    if (seeded !== undefined) return seeded as StoreDataMap[N];
  }

  try {
    if (!highCapacityStores.has(name)) return readLegacyStore(name);

    const database = await openDatabase();
    if (!database) return readLegacyStore(name);

    const value = await readIndexedValue<StoreDataMap[N] | null>(database, storageKey(name));
    // null 是 clearStore 留下的 tombstone：不能回退到旧 localStorage，否则已删除歌单会复活。
    if (value !== undefined) return value ?? undefined;

    const legacy = readLegacyStore(name);
    if (legacy === undefined) return undefined;
    await writeIndexedValue(database, storageKey(name), legacy);
    getStorage()?.removeItem(storageKey(name));
    return legacy;
  } catch (err) {
    console.error(`[web.getStore] ${String(name)}:`, err);
    return undefined;
  }
}

async function webSetStore<N extends StoreName>(name: N, value: StoreDataMap[N]): Promise<void> {
  try {
    if (highCapacityStores.has(name)) {
      const database = await openDatabase();
      if (database) {
        await writeIndexedValue(database, storageKey(name), value);
        getStorage()?.removeItem(storageKey(name));
        return;
      }
    }

    const serialized = JSON.stringify(value);
    if (serialized !== undefined) getStorage()?.setItem(storageKey(name), serialized);
  } catch (err) {
    console.error(`[web.setStore] ${String(name)}:`, err);
  }
}

async function webClearStore(name: StoreName): Promise<void> {
  try {
    if (highCapacityStores.has(name)) {
      const database = await openDatabase();
      if (database) {
        await writeIndexedValue(database, storageKey(name), null);
        getStorage()?.removeItem(storageKey(name));
        return;
      }
    }
    getStorage()?.removeItem(storageKey(name));
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
    if (isOfflineDemo) return false;
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
  searchNeteaseSongs: async params => (isOfflineDemo ? {} : searchWebNeteaseSongs(params)),
  getNeteaseSimilarSongs: async () => ({}),
  getNeteaseLyrics: async params => (isOfflineDemo ? {} : getWebNeteaseLyrics(params)),
  searchLrclibLyrics: async params => (isOfflineDemo ? [] : searchWebLrclibLyrics(params)),
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
  getMediaDownloadTaskList: async () => {
    if (!isOfflineDemo) return [];
    const { DEMO_DOWNLOAD_TASKS } = await import("@/common/offline-demo-fixtures");
    return DEMO_DOWNLOAD_TASKS as unknown as MediaDownloadTask[];
  },
  syncMediaDownloadTaskList: unsubscribe,
  addMediaDownloadTask: asyncNoop,
  addMediaDownloadTaskList: asyncNoop,
  pauseMediaDownloadTask: asyncNoop,
  resumeMediaDownloadTask: asyncNoop,
  cancelMediaDownloadTask: asyncNoop,
  retryMediaDownloadTask: asyncNoop,
  clearMediaDownloadTaskList: asyncNoop,
  scanLocalMusic: async () => {
    if (!isOfflineDemo) return [];
    const { DEMO_LOCAL_MUSIC } = await import("@/common/offline-demo-fixtures");
    return DEMO_LOCAL_MUSIC;
  },
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
  error: (...args) => {
    console.error(...args);
    reportWebLog("error", args);
  },
  warn: (...args) => {
    console.warn(...args);
    reportWebLog("warn", args);
  },
  info: (...args) => console.info(...args),
  debug: (...args) => console.debug(...args),
};

installWebLogTransport();

export default platform;
