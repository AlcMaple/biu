import { describe, expect, it } from "vitest";

import {
  createPlaylistSession,
  playlistScope,
  type PlaylistPartition,
  type PlaylistPartitionStore,
} from "@/platform/web-playlist-partition";

const song = (rid: string | number, extra = {}) => ({ rid, type: 2, title: `歌曲 ${rid}`, fav_time: 100, ...extra });

function memoryStore() {
  const records = new Map<string, PlaylistPartition>();
  let tail: Promise<unknown> = Promise.resolve();
  let fail = false;
  let holdRead: Promise<void> | undefined;
  const store: PlaylistPartitionStore = {
    read: async scope => {
      const result = structuredClone(records.get(scope));
      await holdRead;
      return result;
    },
    update: (scope, transform) => {
      const next = tail.then(() => {
        if (fail) throw new Error("模拟存储失败");
        const result = transform(structuredClone(records.get(scope)));
        records.set(scope, structuredClone(result.partition));
        return result.result;
      });
      tail = next.catch(() => undefined);
      return next;
    },
  };
  return {
    store,
    records,
    fail: (value: boolean) => (fail = value),
    holdRead: (value: Promise<void> | undefined) => (holdRead = value),
  };
}

describe("Web 收藏分区基础（尚未接入登录生命周期）", () => {
  it("只接受明确访客或有效账号标识", () => {
    expect(playlistScope(null)).toBe("guest");
    expect(playlistScope(900001)).toBe("account:900001");
    for (const mid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => playlistScope(mid)).toThrow();
    }
  });

  it("A、B与访客的收藏、元数据和标签独立，重建会话仍保留", async () => {
    const { store } = memoryStore();
    for (const mid of [null, 900001, 900002]) {
      const session = createPlaylistSession(store, playlistScope(mid));
      await session.write("items", { folderItems: { [-1]: [song(String(mid))] }, replaceLogs: {} });
      await session.write("favorites", {
        createdFavorites: [{ id: -10, title: String(mid), isLocal: true }],
        createdOrder: [-10],
        collectedOrder: [],
      });
      await session.write("tags", { tags: [{ id: 1, name: String(mid), color: "red" }], itemTags: {} });
      session.close();
    }
    for (const mid of [null, 900001, 900002]) {
      const value = await createPlaylistSession(store, playlistScope(mid)).read();
      expect(value.items.folderItems[-1][0].rid).toBe(String(mid));
      expect(value.favorites.createdFavorites[0].title).toBe(String(mid));
      expect(value.tags.tags[0].name).toBe(String(mid));
    }
  });

  it("不使用账号登录信息、云同步基线或其他存储键作为分区内容", async () => {
    const { store, records } = memoryStore();
    const session = createPlaylistSession(store, playlistScope(900001));
    await session.write("tags", { tags: [], itemTags: {} });
    expect([...records.keys()]).toEqual(["account:900001"]);
    expect(Object.keys(records.get("account:900001")!.data)).toEqual(["favorites", "items", "tags"]);
  });

  it("晚到的旧会话读取被拒绝，不可当成新账号结果", async () => {
    const memory = memoryStore();
    let release!: () => void;
    memory.holdRead(new Promise<void>(resolve => (release = resolve)));
    const old = createPlaylistSession(memory.store, playlistScope(900001));
    const pending = old.read();
    old.close();
    const next = createPlaylistSession(memory.store, playlistScope(900002));
    memory.holdRead(undefined);
    release();
    await expect(pending).rejects.toThrow("会话已切换");
    expect((await next.read()).items.folderItems).toEqual({});
  });

  it("排队写入在旧会话关闭后拒绝，不写进A或B", async () => {
    const { store, records } = memoryStore();
    const old = createPlaylistSession(store, playlistScope(900001));
    const pending = old.write("items", { folderItems: { [-1]: [song(1)] }, replaceLogs: {} });
    old.close();
    await expect(pending).rejects.toThrow("会话已切换");
    expect(records.size).toBe(0);
  });

  it("并发写不同字段不覆盖其他已提交字段", async () => {
    const { store } = memoryStore();
    const session = createPlaylistSession(store, playlistScope(900001));
    await Promise.all([
      session.write("items", { folderItems: { [-1]: [song(1)] }, replaceLogs: {} }),
      session.write("tags", { tags: [{ id: 2, name: "通勤", color: "green" }], itemTags: {} }),
    ]);
    const data = await session.read();
    expect(data.items.folderItems[-1]).toHaveLength(1);
    expect(data.tags.tags).toHaveLength(1);
  });

  it("写入参数和读取结果不与持久化记录共享可变引用", async () => {
    const { store } = memoryStore();
    const session = createPlaylistSession(store, "guest");
    const items = { folderItems: { [-1]: [song(1)] }, replaceLogs: {} };
    const pending = session.write("items", items);
    items.folderItems[-1][0].title = "调用后篡改";
    await pending;
    const read = await session.read();
    read.items.folderItems[-1][0].title = "读取后篡改";
    expect((await session.read()).items.folderItems[-1][0].title).toBe("歌曲 1");
  });

  it("访客无红心歌曲时不询问，其他歌单和标签不触发询问", async () => {
    const { store } = memoryStore();
    await createPlaylistSession(store, "guest").write("items", {
      folderItems: { [-99]: [song(1)] },
      replaceLogs: {},
    });
    expect(await createPlaylistSession(store, playlistScope(900001)).guestOffer()).toBeNull();
  });

  it("只产生明确选择，不自动复制访客内容到账号", async () => {
    const { store } = memoryStore();
    await createPlaylistSession(store, "guest").write("items", {
      folderItems: { [-1]: [song(1)], [-99]: [song(2)] },
      replaceLogs: {},
    });
    const account = createPlaylistSession(store, playlistScope(900001));
    expect((await account.guestOffer())?.items).toHaveLength(1);
    expect((await account.read()).items.folderItems).toEqual({});
  });

  it("不并入后保留访客原件，同账号相同内容重登不再询问", async () => {
    const { store } = memoryStore();
    const guest = createPlaylistSession(store, "guest");
    await guest.write("items", { folderItems: { [-1]: [song(1)] }, replaceLogs: {} });
    const before = await guest.read();
    const account = createPlaylistSession(store, playlistScope(900001));
    await account.decideGuest((await account.guestOffer())!, "keep");
    expect(await guest.read()).toEqual(before);
    expect((await account.read()).items.folderItems).toEqual({});
    expect(await createPlaylistSession(store, playlistScope(900001)).guestOffer()).toBeNull();
    expect(await createPlaylistSession(store, playlistScope(900002)).guestOffer()).not.toBeNull();
  });

  it("访客增加歌曲后再次提供询问，改其他歌单不打扰", async () => {
    const { store } = memoryStore();
    const guest = createPlaylistSession(store, "guest");
    const account = createPlaylistSession(store, playlistScope(900001));
    await guest.write("items", { folderItems: { [-1]: [song(1)] }, replaceLogs: {} });
    await account.decideGuest((await account.guestOffer())!, "keep");
    await guest.write("items", { folderItems: { [-1]: [song(1)], [-2]: [song(2)] }, replaceLogs: {} });
    expect(await account.guestOffer()).toBeNull();
    await guest.write("items", { folderItems: { [-1]: [song(1), song(3)] }, replaceLogs: {} });
    expect((await account.guestOffer())?.items).toHaveLength(2);
  });

  it("明确并入只追加目标红心，保留双方原元数据和其他歌单", async () => {
    const { store } = memoryStore();
    const guest = createPlaylistSession(store, "guest");
    const account = createPlaylistSession(store, playlistScope(900001));
    await guest.write("items", { folderItems: { [-1]: [song(1), song(2)], [-99]: [song(99)] }, replaceLogs: {} });
    await guest.write("tags", { tags: [{ id: 1, name: "访客标签", color: "red" }], itemTags: {} });
    await account.write("items", {
      folderItems: { [-1]: [song(1, { title: "账号自定标题" })], [-20]: [song(20)] },
      replaceLogs: {},
    });
    const guestBefore = await guest.read();
    const offer = (await account.guestOffer())!;
    expect(await account.decideGuest(offer, "merge")).toBe(1);
    const result = await account.read();
    expect(result.items.folderItems[-1].map(item => item.rid)).toEqual([1, 2]);
    expect(result.items.folderItems[-1][0].title).toBe("账号自定标题");
    expect(result.items.folderItems[-20]).toHaveLength(1);
    expect(result.items.folderItems[-99]).toBeUndefined();
    expect(result.tags.tags).toEqual([]);
    expect(result.favorites.createdFavorites.filter(folder => folder.id === -1)).toHaveLength(1);
    expect(await guest.read()).toEqual(guestBefore);
    expect(await account.decideGuest(offer, "merge")).toBe(0);
    expect(await account.guestOffer()).toBeNull();
  });

  it("去重区分视频整稿、分集、音频与本地文件，兼容数字/字符串rid", async () => {
    const { store } = memoryStore();
    const guest = createPlaylistSession(store, "guest");
    const account = createPlaylistSession(store, playlistScope(900001));
    await guest.write("items", {
      folderItems: {
        [-1]: [song(1), song("1"), song(1, { cid: "8" }), song(1, { type: 12 }), song(1, { source: "local" })],
      },
      replaceLogs: {},
    });
    expect(await account.decideGuest((await account.guestOffer())!, "merge")).toBe(4);
  });

  it("同稿不同rid以bvid去重，同稿不同分集仍保留", async () => {
    const { store } = memoryStore();
    const guest = createPlaylistSession(store, "guest");
    const account = createPlaylistSession(store, playlistScope(900001));
    await guest.write("items", {
      folderItems: {
        [-1]: [
          song(1, { bvid: "BVfixture" }),
          song(2, { bvid: "BVfixture" }),
          song(3, { bvid: "BVfixture", cid: "4" }),
        ],
      },
      replaceLogs: {},
    });
    expect(await account.decideGuest((await account.guestOffer())!, "merge")).toBe(2);
  });

  it("并入写盘失败不记选择、不更新账号，也不删访客原件；可重试", async () => {
    const memory = memoryStore();
    const guest = createPlaylistSession(memory.store, "guest");
    const account = createPlaylistSession(memory.store, playlistScope(900001));
    await guest.write("items", { folderItems: { [-1]: [song(1)] }, replaceLogs: {} });
    const before = await guest.read();
    const offer = (await account.guestOffer())!;
    memory.fail(true);
    await expect(account.decideGuest(offer, "merge")).rejects.toThrow("模拟存储失败");
    memory.fail(false);
    expect((await account.read()).items.folderItems).toEqual({});
    expect(await account.guestOffer()).not.toBeNull();
    expect(await guest.read()).toEqual(before);
    expect(await account.decideGuest(offer, "merge")).toBe(1);
  });

  it("A的询问不允许由B会话提交，访客也不能并入自身", async () => {
    const { store } = memoryStore();
    const guest = createPlaylistSession(store, "guest");
    await guest.write("items", { folderItems: { [-1]: [song(1)] }, replaceLogs: {} });
    const a = createPlaylistSession(store, playlistScope(900001));
    const b = createPlaylistSession(store, playlistScope(900002));
    const offer = (await a.guestOffer())!;
    await expect(b.decideGuest(offer, "merge")).rejects.toThrow("目标账号已变化");
    await expect(guest.decideGuest(offer, "merge")).rejects.toThrow();
  });

  it("旧弹窗重复提交不撤销用户之后的删除或不并入决定", async () => {
    const { store } = memoryStore();
    await createPlaylistSession(store, "guest").write("items", {
      folderItems: { [-1]: [song(1)] },
      replaceLogs: {},
    });
    const a = createPlaylistSession(store, playlistScope(900001));
    const offer = (await a.guestOffer())!;
    await a.decideGuest(offer, "merge");
    await a.write("items", { folderItems: { [-1]: [] }, replaceLogs: {} });
    expect(await a.decideGuest(offer, "merge")).toBe(0);
    expect((await a.read()).items.folderItems[-1]).toEqual([]);
    const b = createPlaylistSession(store, playlistScope(900002));
    const bOffer = (await b.guestOffer())!;
    await b.decideGuest(bOffer, "keep");
    expect(await b.decideGuest(bOffer, "merge")).toBe(0);
    expect((await b.read()).items.folderItems).toEqual({});
  });

  it("晚到的旧版本决定不覆盖已经确认的新版本", async () => {
    const { store } = memoryStore();
    const guest = createPlaylistSession(store, "guest");
    const a = createPlaylistSession(store, playlistScope(900001));
    await guest.write("items", { folderItems: { [-1]: [song(1)] }, replaceLogs: {} });
    const old = (await a.guestOffer())!;
    await guest.write("items", { folderItems: { [-1]: [song(1), song(2)] }, replaceLogs: {} });
    await a.decideGuest((await a.guestOffer())!, "keep");
    await expect(a.decideGuest(old, "merge")).rejects.toThrow("版本已变化");
    expect((await a.read()).items.folderItems).toEqual({});
  });
});
