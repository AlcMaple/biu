import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { StoreNameMap as Names } from "@shared/store";
import type { DesktopPlaylistAccounts } from "../electron/playlist-accounts";

let root: string;
let Accounts: typeof DesktopPlaylistAccounts;
const openAccounts = (owners: number[], meta: PlaylistSyncMetaData = {}) =>
  new Accounts(root, () => ({ owners, meta }));
const folder = { id: -2, isLocal: true, title: "升级前" };
const song = { rid: "12", title: "旧歌", type: 2, fav_time: 42 };
const tag = { id: 3, name: "旧标签", color: "#ffffff" };
const file = (name: string) => path.join(root, name + ".json");
const write = (name: string, value: unknown) => fs.writeFileSync(file(name), JSON.stringify(value));

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "biu-playlist-"));
  // electron-store 在 Node 下同样使用真实文件；提供占位路径，避免 npm 包尝试启动或下载 Electron。
  vi.stubEnv("ELECTRON_OVERRIDE_DIST_PATH", root);
  Accounts = (await import("../electron/playlist-accounts")).DesktopPlaylistAccounts;
  write(Names.LocalFavorites, { createdFavorites: [folder], createdOrder: [-2] });
  write(Names.LocalFavItems, { folderItems: { "-2": [song] } });
  write(Names.Tags, { tags: [tag], itemTags: { track: [3] } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it("已知唯一旧账号，其他账号先登录也拿不到它的歌单；迁移保留原文件", () => {
  const snapshot = (payload: unknown) => ({ updatedAt: 42, payload });
  const accounts = openAccounts([42, 42], {
    "42": {
      versions: {},
      snapshots: {
        favorites: { "-2": snapshot(folder) },
        "fav-items": { "-2:12": snapshot({ folderId: -2, item: song }) },
        tags: { "tag:3": snapshot(tag), "item:track": snapshot([3]) },
      },
    },
  });
  const original = fs.readFileSync(file(Names.LocalFavorites));
  expect(accounts.prepare(99)).toBe(false);
  expect(accounts.accountStore(99, Names.LocalFavorites).store).toEqual({});
  expect(accounts.prepare(42)).toBe(false);
  expect(accounts.accountStore(42, Names.LocalFavorites).store.createdOrder).toEqual([-2]);
  expect(accounts.accountStore(42, Names.LocalFavItems).store.folderItems?.[-2]).toEqual([song]);
  expect(accounts.accountStore(42, Names.Tags).store.itemTags).toEqual({ track: [3] });
  expect(fs.readFileSync(file(Names.LocalFavorites))).toEqual(original);
  accounts.accountStore(42, Names.LocalFavItems).store = { folderItems: {} };
  openAccounts([99]).prepare(42);
  expect(accounts.accountStore(42, Names.LocalFavItems).store.folderItems).toEqual({});
});

it.each([{ owners: [] }, { owners: [42] }, { owners: [42, 99] }])(
  "旧文件归属不清，需要明确认领，保留当前账号的歌曲和标签 ($owners)",
  ({ owners }) => {
    const accounts = openAccounts(owners);
    expect(accounts.prepare(42)).toBe(true);
    expect(accounts.prepare(99)).toBe(true);
    expect(accounts.accountStore(42, Names.Tags).store).toEqual({});
    const current = { ...song, rid: 12, title: "当前账号已改名" };
    accounts.accountStore(99, Names.LocalFavItems).store = { folderItems: { "-2": [current] } };
    accounts.accountStore(99, Names.Tags).store = { tags: [{ ...tag, id: 4 }], itemTags: { track: [4] } };
    expect(accounts.prepare(99, true)).toBe(false);
    expect(accounts.accountStore(99, Names.LocalFavItems).store.folderItems?.[-2]).toEqual([current]);
    expect(accounts.accountStore(99, Names.Tags).store.itemTags).toEqual({ track: [4, 3] });
    expect(accounts.accountStore(42, Names.LocalFavorites).store).toEqual({});
    expect(() => openAccounts([]).prepare(42, true)).toThrow("其他账号");
  },
);

it("认领过程中最后一个文件读取失败，重启后由原账号接着合并", () => {
  const accounts = openAccounts([42, 99]);
  write(Names.Tags, { tags: "损坏" });
  expect(() => accounts.prepare(99, true)).toThrow();
  write(Names.Tags, { tags: [tag] });
  const reopened = openAccounts([]);
  expect(() => reopened.prepare(42, true)).toThrow("其他账号");
  reopened.prepare(99);
  expect(reopened.accountStore(99, Names.LocalFavItems).store.folderItems?.[-2]).toEqual([song]);
  expect(reopened.accountStore(99, Names.Tags).store.tags).toEqual([tag]);
});
