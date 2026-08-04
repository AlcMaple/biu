/**
 * 回归测试：覆盖写之前必须留下历史版本。
 *
 * 背景：真实事故——客户端在状态未就绪时把整个歌单 diff 成全量删除推上来，服务端如实
 * 执行，墓碑连 payload 一起丢弃，云端数据不可逆。客户端可以出错，服务端不能因此丢数据。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dataDir: string;

vi.mock("../config.js", () => ({
  config: {
    get dataDir() {
      return dataDir;
    },
    tombstoneRetentionDays: 30,
  },
}));

const { getEnvelope, mutateEnvelope } = await import("../storage.js");

const MID = "12345";

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "biu-sync-test-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

async function historyFiles() {
  try {
    return (await fs.readdir(path.join(dataDir, MID, "history"))).sort();
  } catch {
    return [];
  }
}

describe("写前历史版本", () => {
  it("首次写入（云端本来是空的）不产生无意义的历史文件", async () => {
    await mutateEnvelope(MID, "favorites", current => ({
      ...current,
      version: 1,
      data: { a: { updatedAt: 1, payload: { title: "歌单A" } } },
    }));

    expect(await historyFiles()).toEqual([]);
  });

  it("覆盖写之前把上一版完整存进 history，payload 可完整取回", async () => {
    const v1 = { a: { updatedAt: 1, payload: { title: "歌单A" } } };
    await mutateEnvelope(MID, "favorites", current => ({ ...current, version: 1, updatedAt: 111, data: v1 }));

    // 模拟事故：一批 remove 把活条目打成墓碑，payload 丢失
    await mutateEnvelope(MID, "favorites", current => ({
      ...current,
      version: 2,
      updatedAt: 222,
      data: { a: { __deleted: true, updatedAt: 222 } },
    }));

    const current = await getEnvelope(MID, "favorites");
    expect(current.data.a).toEqual({ __deleted: true, updatedAt: 222 }); // 线上已被删空

    const files = await historyFiles();
    expect(files).toHaveLength(1);
    const restored = JSON.parse(await fs.readFile(path.join(dataDir, MID, "history", files[0]), "utf-8")) as {
      data: unknown;
    };
    expect(restored.data).toEqual(v1); // 但历史版本里 payload 还在，可还原
  });

  it("历史版本按版本号排序保留，不同 store 互不干扰", async () => {
    for (let v = 1; v <= 3; v++) {
      await mutateEnvelope(MID, "favorites", current => ({
        ...current,
        version: v,
        updatedAt: v * 100,
        data: { a: { updatedAt: v, payload: { v } } },
      }));
      await mutateEnvelope(MID, "tags", current => ({ ...current, version: v, updatedAt: v * 100, data: {} }));
    }

    const files = await historyFiles();
    expect(files.filter(f => f.startsWith("favorites-"))).toEqual([
      "favorites-v000001-100.json",
      "favorites-v000002-200.json",
    ]);
    expect(files.filter(f => f.startsWith("tags-"))).toHaveLength(2);
  });
});
