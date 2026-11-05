import {
  createIndexedDBPlaylistPartitionStore,
  createPlaylistSession,
  playlistScope,
} from "../../src/platform/web-playlist-partition";

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("biu-partition-engineering-fixture", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("stores");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const assert = (condition: boolean, text: string) => {
  if (!condition) throw new Error(text);
};

const rejects = async (operation: Promise<unknown>) => {
  try {
    await operation;
  } catch {
    return;
  }
  throw new Error("预期拒绝，但操作成功");
};

async function raw(database: IDBDatabase, key: string, value?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("stores", value === undefined ? "readonly" : "readwrite");
    const store = transaction.objectStore("stores");
    const request = value === undefined ? store.get(key) : store.put(value, key);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

document.getElementById("run")!.addEventListener("click", async () => {
  const output = document.getElementById("results")!;
  output.textContent = "";
  const database = await open();
  const otherConnection = await open();
  const prefix = `fixture-${Date.now()}:`;
  const store = createIndexedDBPlaylistPartitionStore(database, prefix);
  const secondStore = createIndexedDBPlaylistPartitionStore(otherConnection, prefix);
  const guest = createPlaylistSession(store, "guest");
  const a = createPlaylistSession(store, playlistScope(900001));
  const b = createPlaylistSession(store, playlistScope(900002));
  const items = { folderItems: { [-1]: [{ rid: 1, type: 2, title: "合成歌曲", fav_time: 100 }] }, replaceLogs: {} };
  let passed = 0;
  let failed = 0;
  const check = async (name: string, action: () => Promise<void>) => {
    const row = document.createElement("li");
    try {
      await action();
      row.textContent = `PASS ${name}`;
      passed += 1;
    } catch (error) {
      row.textContent = `FAIL ${name}: ${String(error)}`;
      failed += 1;
    }
    output.append(row);
  };
  try {
    await check("A/B/访客真实IndexedDB分区，无自动复制", async () => {
      await guest.write("items", items);
      assert((await a.read()).items.folderItems[-1] === undefined, "A读到访客内容");
      assert((await b.read()).items.folderItems[-1] === undefined, "B读到访客内容");
    });
    await check("不并入的决定与歌曲持久化，重建会话仍抑制询问", async () => {
      await a.decideGuest((await a.guestOffer())!, "keep");
      assert((await createPlaylistSession(secondStore, playlistScope(900001)).guestOffer()) === null, "决定未持久化");
      assert((await guest.read()).items.folderItems[-1].length === 1, "访客原件改变");
    });
    await check("明确并入到B，重复提交幂等，A仍为空", async () => {
      const offer = (await b.guestOffer())!;
      assert((await b.decideGuest(offer, "merge")) === 1, "没有新增");
      assert((await b.decideGuest(offer, "merge")) === 0, "重复新增");
      assert((await a.read()).items.folderItems[-1] === undefined, "A被污染");
    });
    await check("两个数据库连接并发写同一账号不丢字段", async () => {
      const otherB = createPlaylistSession(secondStore, playlistScope(900002));
      await Promise.all([
        b.write("items", { ...items, folderItems: { [-1]: items.folderItems[-1], [-20]: [] } }),
        otherB.write("tags", { tags: [{ id: 1, name: "合成标签", color: "green" }], itemTags: {} }),
      ]);
      const state = await b.read();
      assert(state.tags.tags.length === 1 && state.items.folderItems[-20] !== undefined, "并发字段覆盖");
    });
    await check("事务中断保留账号完整记录和访客原件", async () => {
      const before = JSON.stringify(await b.read());
      await rejects(
        store.update(playlistScope(900002), current => {
          current!.data.items.folderItems = {};
          throw new Error("模拟事务中断");
        }),
      );
      assert(JSON.stringify(await b.read()) === before, "事务没有回滚");
      assert((await guest.read()).items.folderItems[-1].length === 1, "访客原件改变");
    });
    await check("旧会话晚到读取和排队写入拒绝", async () => {
      const old = createPlaylistSession(store, playlistScope(900001));
      const read = old.read();
      old.close();
      await rejects(read);
      await rejects(old.write("items", items));
    });
    await check("不认领、不覆盖、不删除未分区原件与云同步记账", async () => {
      const original = { original: "合成旧数据" };
      for (const name of ["local-favorites", "local-fav-items", "tags", "playlist-sync-meta"]) {
        await raw(database, `${prefix}${name}`, original);
      }
      await b.write("items", items);
      for (const name of ["local-favorites", "local-fav-items", "tags", "playlist-sync-meta"]) {
        assert(JSON.stringify(await raw(database, `${prefix}${name}`)) === JSON.stringify(original), "旧键被修改");
      }
    });
    await check("损坏记录显式报错，读写都不以空数据覆盖", async () => {
      const corrupt = { schema: 99, marker: "保留原件" };
      const key = `${prefix}playlist-partition:v1:account:900009`;
      await raw(database, key, corrupt);
      const account = createPlaylistSession(store, playlistScope(900009));
      await rejects(account.read());
      await rejects(account.write("items", items));
      assert(JSON.stringify(await raw(database, key)) === JSON.stringify(corrupt), "损坏原件被覆盖");
    });
    await check("连接关闭后拒绝写盘，不记成并入成功", async () => {
      database.close();
      await rejects(b.write("items", { folderItems: {}, replaceLogs: {} }));
      const restored = createPlaylistSession(secondStore, playlistScope(900002));
      assert((await restored.read()).items.folderItems[-1].length === 1, "失败写入改变数据");
    });
  } finally {
    database.close();
    otherConnection.close();
    document.getElementById("summary")!.textContent = `${passed} passed / ${failed} failed`;
  }
});
