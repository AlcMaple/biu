import { beforeEach, describe, expect, it, vi } from "vitest";

const disk: Record<string, unknown> = {};
let owner: number | null = null;

vi.mock("@/platform", () => ({
  isWeb: true,
  isElectron: false,
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  default: {
    getStore: vi.fn(async (name: string) => (owner === null ? undefined : disk[`${owner}:${name}`])),
    setStore: vi.fn(async (name: string, value: unknown) => {
      if (owner !== null) disk[`${owner}:${name}`] = structuredClone(value);
    }),
    clearStore: vi.fn(async () => {}),
  },
}));
vi.mock("@/platform/ready", () => ({ platformReady: new Promise(() => {}) }));
vi.mock("@/platform/web", () => ({
  setWebPlaylistOwner: (mid: number | null) => {
    owner = mid;
  },
}));

const { default: platform } = await import("@/platform");
const { usePlaylistSession } = await import("@/store/playlist-session");
const { StoreNameMap } = await import("@shared/store");
const { useLocalFavItemsStore } = await import("@/store/local-fav-items");
const { switchPlaylistAccount } = await import("@/store/playlist-account");
const { planAccountPlaylists } = await import("@/platform/web-playlist-account");

const song = (rid: number) => ({ rid, title: `歌${rid}`, type: 2, fav_time: 1 });

beforeEach(() => {
  for (const key of Object.keys(disk)) delete disk[key];
});

describe("网页版本地歌单按账号存", () => {
  it("A 的旧文件慢于 B，B 的内容仍然保留，读取失败时也禁止编辑和同步", async () => {
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>(r => {
      release = r;
    });
    const reading = new Promise<void>(r => {
      started = r;
    });
    const getStore = vi.mocked(platform.getStore);
    const original = getStore.getMockImplementation()!;
    getStore.mockImplementation(async (name, mid) => {
      const saved = await original(name, mid);
      if (name === StoreNameMap.LocalFavItems && mid === 11) {
        started();
        await pending;
      }
      if (name === StoreNameMap.Tags && mid === 13) throw new Error("文件正在占用");
      return saved;
    });
    try {
      disk["11:" + StoreNameMap.LocalFavItems] = { folderItems: { "-1": [song(11)] } };
      disk["12:" + StoreNameMap.LocalFavItems] = { folderItems: { "-1": [song(12)] } };
      const first = switchPlaylistAccount(11);
      await reading;
      await switchPlaylistAccount(12);
      release();
      await first;
      expect(useLocalFavItemsStore.getState().folderItems[-1].map(i => i.rid)).toEqual([12]);
      await switchPlaylistAccount(13);
      expect(usePlaylistSession.getState()).toMatchObject({ mid: 13, ready: false, error: "文件正在占用" });
      expect(useLocalFavItemsStore.getState().folderItems).toEqual({});
    } finally {
      release();
      getStore.mockImplementation(original);
      await switchPlaylistAccount(null);
    }
  });
  it("A 的歌不会写进 B，B 登录后看到的是 B 自己的", async () => {
    disk[`1:${StoreNameMap.LocalFavItems}`] = { folderItems: { "-1": [song(1)] }, replaceLogs: {} };
    disk[`2:${StoreNameMap.LocalFavItems}`] = { folderItems: { "-1": [song(2)] }, replaceLogs: {} };

    await switchPlaylistAccount(1);
    expect(useLocalFavItemsStore.getState().folderItems[-1]?.map(i => i.rid)).toEqual([1]);

    await switchPlaylistAccount(2);
    expect(useLocalFavItemsStore.getState().folderItems[-1]?.map(i => i.rid)).toEqual([2]);
    expect(
      (disk[`2:${StoreNameMap.LocalFavItems}`] as { folderItems: Record<string, { rid: number }[]> }).folderItems[
        "-1"
      ].map(i => i.rid),
    ).toEqual([2]);
    expect(
      (disk[`1:${StoreNameMap.LocalFavItems}`] as { folderItems: Record<string, { rid: number }[]> }).folderItems[
        "-1"
      ].map(i => i.rid),
    ).toEqual([1]);

    await switchPlaylistAccount(null);
    expect(useLocalFavItemsStore.getState().folderItems).toEqual({});
  });
});

describe("更新前那份共用收藏交给谁", () => {
  const synced = { "1": { epoch: 1, versions: { favorites: 3 }, snapshots: {} } } as unknown as PlaylistSyncMetaData;

  it("没有任何账号同步过：交给第一个登录的账号", () => {
    expect(planAccountPlaylists({}, 1, false)).toEqual({ copyLegacy: true, resetBaseline: false });
  });
  it("已被认领过：第二个账号不再拿", () => {
    expect(planAccountPlaylists({}, 2, true).copyLegacy).toBe(false);
  });
  it("同步过的账号从服务器拿，并清掉旧基线走只增不删", () => {
    expect(planAccountPlaylists(synced, 1, false)).toEqual({ copyLegacy: false, resetBaseline: true });
  });
  it("别的账号同步过：新账号不拿共用收藏", () => {
    expect(planAccountPlaylists(synced, 2, false)).toEqual({ copyLegacy: false, resetBaseline: false });
  });
});
