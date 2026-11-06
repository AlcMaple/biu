import { createLegacyPlaylistRecovery, legacyPlaylistNames } from "../../src/platform/web-playlist-legacy";
import {
  createIndexedDBPlaylistPartitionStore,
  createPlaylistSession,
  webPlaylistPartitionKey,
} from "../../src/platform/web-playlist-partition";
import { legacyPlaylistSample } from "./legacy-playlist-sample";

const sample = legacyPlaylistSample();
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("biu-sandbox-web-store", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("stores");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const assert = (condition: boolean, reason: string) => {
  if (!condition) throw new Error(reason);
};
const raw = (db: IDBDatabase, key: string, value?: unknown) =>
  new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction("stores", value === undefined ? "readonly" : "readwrite");
    const store = tx.objectStore("stores");
    const request = value === undefined ? store.get(key) : store.put(value, key);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch {
    return;
  }
  throw new Error("预期失败却成功");
};
const seed = async (db: IDBDatabase, prefix: string) => {
  for (const name of legacyPlaylistNames) await raw(db, prefix + name, sample[name]);
};
const make = (db: IDBDatabase, prefix: string, mid: number | null) => {
  const session = createPlaylistSession(
    createIndexedDBPlaylistPartitionStore(db, prefix),
    mid === null ? "guest" : `account:${mid}`,
  );
  return {
    session,
    recovery: createLegacyPlaylistRecovery(db, prefix, session.scope, () => undefined, session.checkActive),
  };
};

document.getElementById("seed")!.addEventListener("click", async () => {
  const status = document.getElementById("status")!;
  const db = await open();
  try {
    assert(location.hostname.startsWith("biu-legacy-sample-"), "只向指定合成样本来源写入");
    for (const name of legacyPlaylistNames)
      assert((await raw(db, "biu-sandbox:" + name)) === undefined, "已有原件，保留而不重置");
    await seed(db, "biu-sandbox:");
    status.textContent = "合成旧版样本已写入：2歌单、2首歌、1标签；不是用户历史";
  } catch (error) {
    status.textContent = String(error);
  } finally {
    db.close();
  }
});

document.getElementById("verify")!.addEventListener("click", async () => {
  const db = await open();
  const status = document.getElementById("status")!;
  try {
    for (const name of legacyPlaylistNames)
      assert(JSON.stringify(await raw(db, "biu-sandbox:" + name)) === JSON.stringify(sample[name]), "未分区原件变化");
    const receipt = (await raw(db, "biu-sandbox:playlist-legacy-recovery:v1")) as { owner: string; raw: unknown };
    assert(receipt.owner === "account:900001", "归属不是明确选择的A");
    assert(JSON.stringify(receipt.raw) === JSON.stringify(sample), "归档原件变化");
    const account = await make(db, "biu-sandbox:", 900001).session.read();
    const mapped = receipt as typeof receipt & { folderIds?: Record<number, number>; tagIds?: Record<number, number> };
    if (mapped.folderIds) {
      const liked = account.items.folderItems[-1];
      assert(
        liked.some(item => item.rid === 100003),
        "当前独有歌曲丢失",
      );
      const duplicate = liked.filter(item => String(item.rid) === "100002");
      assert(duplicate.length === 1 && duplicate[0].title !== "旧版·Apologize", "重复歌曲或覆盖当前标题");
      assert(account.items.folderItems[mapped.folderIds[-77]][0].customArtist === "旧版自定歌手", "旧歌手丢失");
      assert(account.tags.itemTags["video:bvid:BV1DEMO00003"].includes(mapped.tagIds![7]), "旧标签未追加");
    } else {
      assert(
        JSON.stringify(account.items.folderItems) === JSON.stringify(sample[legacyPlaylistNames[1]].folderItems),
        "歌曲元数据变化",
      );
      assert(JSON.stringify(account.tags) === JSON.stringify(sample[legacyPlaylistNames[2]]), "标签归属变化");
    }
    const b = await make(db, "biu-sandbox:", 900002).session.read();
    assert(
      Object.values(b.items.folderItems).every(items => items.length === 0),
      "B读取到A原件",
    );
    status.textContent = "PASS 原件/归档/目标A歌曲与标签/目标B隔离";
  } catch (error) {
    status.textContent = "FAIL " + String(error);
  } finally {
    db.close();
  }
});

document.getElementById("checks")!.addEventListener("click", async () => {
  const db = await open();
  const output = document.getElementById("results")!;
  output.textContent = "";
  let passed = 0;
  let failed = 0;
  const check = async (name: string, action: (prefix: string) => Promise<void>) => {
    const prefix = `legacy-engineering-${Date.now()}-${passed}-${failed}:`;
    const li = document.createElement("li");
    try {
      await seed(db, prefix);
      await action(prefix);
      li.textContent = "PASS " + name;
      passed++;
    } catch (error) {
      li.textContent = "FAIL " + name + ": " + String(error);
      failed++;
    }
    output.append(li);
  };
  try {
    await check("只检查不认领，不自动复制", async prefix => {
      const a = make(db, prefix, 900001);
      assert((await a.recovery.inspect())?.songs === 2, "数量错误");
      assert((await raw(db, webPlaylistPartitionKey(prefix, "account:900001"))) === undefined, "自动复制了");
    });
    await check("恢复三store并归档，原件逐字保留", async prefix => {
      const a = make(db, prefix, 900001);
      await a.recovery.recover((await a.recovery.inspect())!);
      for (const n of legacyPlaylistNames)
        assert(JSON.stringify(await raw(db, prefix + n)) === JSON.stringify(sample[n]), "原件变化");
      assert((await a.session.read()).tags.tags[0].name === "旧版标签", "标签丢失");
    });
    await check("同账号幂等，另一账号并发认领被拒", async prefix => {
      const a = make(db, prefix, 900001),
        b = make(db, prefix, 900002);
      const ao = (await a.recovery.inspect())!,
        bo = (await b.recovery.inspect())!;
      const results = await Promise.allSettled([a.recovery.recover(ao), b.recovery.recover(bo)]);
      assert(results.filter(v => v.status === "fulfilled").length === 1, "多个身份取得原件");
      const winner = results[0].status === "fulfilled" ? a : b;
      assert((await winner.recovery.recover(ao)) === false, "重复恢复");
    });
    await check("旧空目标选择不隐式升级合并，新确认才继续", async prefix => {
      const a = make(db, prefix, 900001);
      const oldOffer = (await a.recovery.inspect())!;
      await a.session.write("items", {
        folderItems: { [-1]: [{ rid: 9, type: 2, title: "自己的歌", fav_time: 1 }] },
        replaceLogs: {},
      });
      await rejects(a.recovery.recover(oldOffer));
      assert((await raw(db, prefix + "playlist-legacy-recovery:v1")) === undefined, "错误记成功");
      const fresh = (await a.recovery.inspect())!;
      assert(fresh.mergeRequired === true, "未更新确认方式");
      await a.recovery.recover(fresh);
      assert((await a.session.read()).items.folderItems[-1][0].rid === 9, "当前歌曲被覆");
    });
    await check("非空合并映射歌单和标签冲突，目标与旧原件均保留", async prefix => {
      const a = make(db, prefix, 900001);
      await a.session.write("favorites", {
        createdFavorites: [
          { id: -1, title: "我喜欢的音乐", isLocal: true },
          { id: -77, title: "当前歌单", isLocal: true },
        ],
        createdOrder: [-1, -77],
        collectedOrder: [],
      });
      await a.session.write("items", {
        folderItems: { [-1]: [{ rid: 9, type: 2, title: "当前歌曲", fav_time: 1 }] },
        replaceLogs: {},
      });
      await a.session.write("tags", { tags: [{ id: 7, name: "当前标签", color: "blue" }], itemTags: {} });
      await a.recovery.recover((await a.recovery.inspect())!);
      const result = await a.session.read();
      const receipt = (await raw(db, prefix + "playlist-legacy-recovery:v1")) as {
        folderIds: Record<number, number>;
        tagIds: Record<number, number>;
      };
      assert(receipt.folderIds[-77] !== -77 && receipt.tagIds[7] !== 7, "未映射冲突");
      assert(result.items.folderItems[-1][0].title === "当前歌曲", "丢当前歌");
      assert(result.items.folderItems[receipt.folderIds[-77]][0].title === "旧版·梦醒时分", "丢旧歌");
      assert(result.tags.itemTags["video:bvid:BV1DEMO00003"][0] === receipt.tagIds[7], "旧标签串绑");
      for (const n of legacyPlaylistNames)
        assert(JSON.stringify(await raw(db, prefix + n)) === JSON.stringify(sample[n]), "旧原件变化");
    });
    await check("原件在确认后变化则拒绝旧选择", async prefix => {
      const a = make(db, prefix, 900001),
        offer = (await a.recovery.inspect())!;
      await raw(db, prefix + legacyPlaylistNames[2], { tags: [], itemTags: {} });
      await rejects(a.recovery.recover(offer));
      assert((await raw(db, webPlaylistPartitionKey(prefix, "account:900001"))) === undefined, "落入旧快照");
    });
    await check("旧会话关闭后不落盘", async prefix => {
      const a = make(db, prefix, 900001),
        offer = (await a.recovery.inspect())!;
      a.session.close();
      await rejects(a.recovery.recover(offer));
      assert((await raw(db, prefix + "playlist-legacy-recovery:v1")) === undefined, "错误认领");
    });
    await check("第二次put失败回滚第一次目标写入，可再试", async prefix => {
      const failing = await open();
      const original = failing.transaction.bind(failing);
      failing.transaction = ((...args: Parameters<IDBDatabase["transaction"]>) => {
        const tx = original(...args);
        const store = tx.objectStore("stores"),
          put = store.put.bind(store);
        store.put = (value: unknown, key?: IDBValidKey) => {
          if (key === prefix + "playlist-legacy-recovery:v1") throw new Error("模拟归档写入失败");
          return put(value, key);
        };
        return tx;
      }) as IDBDatabase["transaction"];
      const a = make(failing, prefix, 900001),
        offer = (await a.recovery.inspect())!;
      await rejects(a.recovery.recover(offer));
      failing.close();
      assert((await raw(db, webPlaylistPartitionKey(prefix, "account:900001"))) === undefined, "事务未回滚");
      assert((await raw(db, prefix + "playlist-legacy-recovery:v1")) === undefined, "错误归档");
      const retry = make(db, prefix, 900001);
      assert(await retry.recovery.recover((await retry.recovery.inspect())!), "明确重试失败");
    });
    await check("损坏旧格式保留原件且不显示假空恢复", async prefix => {
      await raw(db, prefix + legacyPlaylistNames[1], { unknownOldVersion: true });
      await rejects(make(db, prefix, 900001).recovery.inspect());
      assert((await raw(db, webPlaylistPartitionKey(prefix, "account:900001"))) === undefined, "损坏原件被替代");
    });
  } finally {
    db.close();
    document.getElementById("summary")!.textContent = `${passed} passed / ${failed} failed`;
  }
});
