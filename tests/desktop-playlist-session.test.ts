import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";

import { StoreNameMap } from "@shared/store";
import { channel } from "../electron/ipc/channel";

const desktop = vi.hoisted(() => ({
  mid: 0,
  meta: {} as PlaylistSyncMetaData,
  root: "",
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
const invoke = (name: string, ...args: unknown[]) => desktop.handlers.get(name)!(undefined, ...args);
vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, fn: (...args: unknown[]) => unknown) => desktop.handlers.set(name, fn) },
}));
vi.mock("electron-log", () => ({ default: { error: vi.fn() } }));
vi.mock("../electron/store", () => ({
  get localDataPath() {
    return desktop.root;
  },
  userStore: {
    set: (user: { mid: number; isLogin: boolean }) => {
      desktop.mid = user.isLogin ? user.mid : 0;
    },
    clear: () => {
      desktop.mid = 0;
    },
    get: (key: string) => (key === "mid" ? desktop.mid : Boolean(desktop.mid)),
  },
  legacyPlaylistSyncMeta: { store: {} },
  playlistSyncMetaStore: {
    get store() {
      return desktop.meta;
    },
  },
  playlistSyncBackupsStore: { store: {} },
}));
vi.mock("@/platform", () => ({
  isWeb: false,
  default: {
    preparePlaylistAccount: (mid: number, claim: boolean) => invoke(channel.store.preparePlaylistAccount, mid, claim),
    getStore: (name: StoreName, owner?: number) => invoke(channel.store.get, name, owner),
    setStore: (name: StoreName, value: unknown, owner?: number) => invoke(channel.store.set, name, value, owner),
    clearStore: (name: StoreName, owner?: number) => invoke(channel.store.clear, name, owner),
  },
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/platform/ready", () => ({ platformReady: new Promise(() => {}) }));

const { initPlaylistAccount, switchPlaylistAccount } = await import("@/store/playlist-account");
const { useFavoritesStore } = await import("@/store/favorite");
const { useLocalFavItemsStore } = await import("@/store/local-fav-items");
const { useTagStore } = await import("@/store/tags");
const { playlistWriteIssue } = await import("@/store/playlist-write");
const { useUser } = await import("@/store/user");
const { createTestUser } = await import("@/common/constants/test-account");
const { usePlaylistSession } = await import("@/store/playlist-session");

it("桌面登录、收藏、建歌单、打标签、退出和重新登录走实际存储处理器", async () => {
  desktop.root = fs.mkdtempSync(path.join(os.tmpdir(), "biu-accounts-ipc-"));
  vi.stubEnv("ELECTRON_OVERRIDE_DIST_PATH", desktop.root);
  try {
    const legacyTags = { tags: [{ id: 71, name: "旧标签", color: "#cccccc" }] };
    const oldFile = path.join(desktop.root, "tags.json");
    fs.writeFileSync(oldFile, JSON.stringify(legacyTags));
    const { registerStoreHandlers } = await import("../electron/ipc/store");
    registerStoreHandlers();
    initPlaylistAccount();
    const login = async (mid: number) => {
      // 真实用户信息由登录接口写入。这里仅模拟身份源，歌单 IPC 和三个 JSON 文件均实际读写。
      useUser.setState({ user: mid ? { ...createTestUser(), mid } : null });
      await vi.waitFor(() =>
        expect(usePlaylistSession.getState()).toMatchObject({ mid: mid || null, ready: Boolean(mid) }),
      );
    };

    expect(playlistWriteIssue("收藏")).toBe("登录后才能收藏");
    expect(playlistWriteIssue("创建收藏夹")).toBe("登录后才能创建收藏夹");
    await login(42);
    expect(playlistWriteIssue("收藏")).toBeUndefined();
    useFavoritesStore.getState().addCreatedFavorite({ id: -2, title: "A 的歌单", isLocal: true });
    useLocalFavItemsStore.getState().addItem(-2, { rid: 123, title: "A 的歌", type: 2 });
    const tag = useTagStore.getState().addTag("A 的标签");
    useTagStore.getState().setItemTags("track", [tag.id]);
    await login(99);
    expect(useFavoritesStore.getState().createdFavorites.map(f => f.id)).toEqual([-1]);
    expect(useLocalFavItemsStore.getState().folderItems).toEqual({});
    expect(useTagStore.getState().tags).toEqual([]);
    await expect(invoke(channel.store.set, StoreNameMap.Tags, { tags: [] }, 42)).rejects.toThrow("账号已切换");
    useTagStore.getState().addTag("B 的标签");
    desktop.meta["42"] = { versions: { favorites: 4, "fav-items": 9, tags: 1 }, snapshots: {} };
    await expect(switchPlaylistAccount(99, true)).rejects.toThrow("首次云同步");
    expect(useTagStore.getState().tags.map(t => t.name)).toEqual(["B 的标签"]);
    desktop.meta["99"] = { versions: { favorites: 0, "fav-items": 0, tags: 0 }, snapshots: {} };
    await switchPlaylistAccount(99, true);
    expect(useTagStore.getState().tags.map(t => t.name)).toEqual(["B 的标签", "旧标签"]);
    expect(JSON.parse(fs.readFileSync(oldFile, "utf8"))).toEqual(legacyTags);
    await login(0);
    expect(useFavoritesStore.getState().createdFavorites).toEqual([]);
    expect(useTagStore.getState().tags).toEqual([]);
    await login(42);
    expect(useFavoritesStore.getState().createdFavorites.map(f => f.title)).toContain("A 的歌单");
    expect(useLocalFavItemsStore.getState().folderItems[-2][0].title).toBe("A 的歌");
    expect(useTagStore.getState().tags.map(t => t.name)).toEqual(["A 的标签"]);
    expect(useTagStore.getState().getItemTagIds("track")).toEqual([tag.id]);
  } finally {
    vi.unstubAllEnvs();
    fs.rmSync(desktop.root, { recursive: true, force: true });
  }
});
