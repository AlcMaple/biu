import { describe, expect, it } from "vitest";

import { createPlayRankingTracker } from "@/store/play-ranking-tracker";
import {
  nextRankingBatch,
  portableRankingRecord,
  updateRankingLocal,
  type RankingLocalState,
} from "@shared/play-ranking";

const now = 1792641600000;
const record: PlayCountRecord = { key: "online:BV1234567890:12", title: "测试曲目", totalCount: 1, recentPlays: [now] };
const empty = () => updateRankingLocal(undefined, undefined, { kind: "read" }, now);

describe("听歌排行可靠本机队列", () => {
  it("大量历史时间明细拆分上报但不截断、不重复累计", () => {
    const legacy = {
      [record.key]: { ...record, totalCount: 20000, recentPlays: Array.from({ length: 12001 }, () => now) },
    };
    const state = updateRankingLocal(undefined, legacy, { kind: "import", mid: "42" }, now);
    const pending = state.accounts["42"].pending;
    expect(pending.map(event => event.record.recentPlays.length)).toEqual([10000, 2001]);
    expect(pending.reduce((sum, event) => sum + event.record.totalCount, 0)).toBe(20000);
  });

  it("按字节和条数双重拆批，避免历史导入超过请求体限制", () => {
    const events = Array.from({ length: 100 }, (_, i) => ({
      seq: i + 1,
      record: { ...record, totalCount: 10000, recentPlays: Array.from({ length: 10000 }, () => now) },
    }));
    const batch = nextRankingBatch(events);
    expect(batch.length).toBeLessThan(100);
    expect(batch.length).toBeGreaterThan(0);
    expect(new TextEncoder().encode(JSON.stringify(batch)).byteLength).toBeLessThan(1_000_000);
    expect(nextRankingBatch(Array.from({ length: 200 }, (_, i) => ({ seq: i + 1, record })))).toHaveLength(100);
  });
  it("读取旧记录不上传、不修改原始数据", () => {
    const legacy = { [record.key]: { ...record, totalCount: 20 } };
    const original = structuredClone(legacy);
    const state = updateRankingLocal(undefined, legacy, { kind: "read" }, now);
    expect(state.unassigned).toEqual(legacy);
    expect(state.accounts).toEqual({});
    expect(legacy).toEqual(original);
  });

  it("确认后仅合并一次，切换账号也不重复导入", () => {
    let state = updateRankingLocal(undefined, { [record.key]: record }, { kind: "read" }, now);
    state = updateRankingLocal(state, undefined, { kind: "import", mid: "42" }, now);
    state = updateRankingLocal(state, undefined, { kind: "import", mid: "42" }, now);
    state = updateRankingLocal(state, undefined, { kind: "import", mid: "99" }, now);
    expect(state.accounts["42"].pending).toHaveLength(1);
    expect(state.accounts["99"].pending).toHaveLength(0);
    expect(state.unassigned).toEqual({});
  });

  it("本机每次播放使用连续序号，账号间独立", () => {
    let state = empty();
    for (const mid of ["42", "99", "42"])
      state = updateRankingLocal(state, undefined, { kind: "record", mid, record }, now);
    expect(state.accounts["42"].pending.map(e => e.seq)).toEqual([1, 2]);
    expect(state.accounts["99"].pending.map(e => e.seq)).toEqual([1]);
  });

  it("旧确认仅清除已确认批次，不覆盖请求期间的新记录", () => {
    let state = empty();
    for (let i = 0; i < 2; i++)
      state = updateRankingLocal(state, undefined, { kind: "record", mid: "42", record }, now);
    state = updateRankingLocal(
      state,
      undefined,
      {
        kind: "ack",
        mid: "42",
        snapshot: { mid: "42", ackSeq: 1, version: 1, updatedAt: now, records: { [record.key]: record } },
      },
      now,
    );
    expect(state.accounts["42"].pending.map(e => e.seq)).toEqual([2]);
    expect(state.accounts["42"].nextSeq).toBe(3);
  });

  it("乱序快照不覆盖新云端结果", () => {
    let state = empty();
    for (const version of [5, 2])
      state = updateRankingLocal(
        state,
        undefined,
        { kind: "ack", mid: "42", snapshot: { mid: "42", version, updatedAt: now, records: {} } },
        now,
      );
    expect(state.accounts["42"].cloud?.version).toBe(5);
  });

  it("另一账号的响应不清空队列", () => {
    const state = updateRankingLocal(empty(), undefined, { kind: "record", mid: "42", record }, now);
    expect(() =>
      updateRankingLocal(
        state,
        undefined,
        { kind: "ack", mid: "42", snapshot: { mid: "99", ackSeq: 1, version: 1, updatedAt: now, records: {} } },
        now,
      ),
    ).toThrow("账号已变化");
    expect(state.accounts["42"].pending).toHaveLength(1);
  });

  it("超出本机已发序号的确认不删除待同步数据", () => {
    const state = updateRankingLocal(empty(), undefined, { kind: "record", mid: "42", record }, now);
    expect(() =>
      updateRankingLocal(
        state,
        undefined,
        { kind: "ack", mid: "42", snapshot: { mid: "42", ackSeq: 8, version: 1, updatedAt: now, records: {} } },
        now,
      ),
    ).toThrow("确认序号异常");
  });

  it("未登录记录保留本机，可在之后明确归属账号", () => {
    let state = updateRankingLocal(empty(), undefined, { kind: "record", mid: null, record }, now);
    expect(state.accounts).toEqual({});
    state = updateRankingLocal(state, undefined, { kind: "import", mid: "99" }, now);
    expect(state.accounts["99"].pending[0].record.totalCount).toBe(1);
  });

  it("本地文件路径与本地封面不进入云端数据", () => {
    const portable = portableRankingRecord(
      {
        ...record,
        key: `local:${["C:", "Users", "person"].join("/")}/music.mp3:`,
        cover: `file:///${["Users", "person"].join("/")}/cover.jpg`,
      },
      now,
    )!;
    expect(portable.key).toMatch(/^local:[a-f0-9]{32}$/);
    expect(portable.cover).toBeUndefined();
    expect(JSON.stringify(portable)).not.toContain("person");
    expect(portableRankingRecord(portable, now)?.key).toBe(portable.key);
  });

  it("升级后保留旧文件，但不在每次打开时重新导入", () => {
    let state = updateRankingLocal(undefined, { [record.key]: record }, { kind: "import", mid: "42" }, now);
    state = updateRankingLocal(state, { [record.key]: record }, { kind: "read" }, now);
    expect(state.unassigned).toEqual({});
    expect(state.accounts["42"].pending).toHaveLength(1);
  });

  it("格式异常不静默重置记录", () => {
    expect(() =>
      updateRankingLocal({ schema: 2 } as unknown as RankingLocalState, undefined, { kind: "read" }, now),
    ).toThrow("格式不受支持");
  });
});

describe("计数等待歌曲身份齐全", () => {
  it("先切歌后补分 P 只计一次；暂停、改封面不计数", () => {
    const calls: string[] = [];
    const track = createPlayRankingTracker(async item => {
      calls.push(`${item.id}:${item.cid}`);
    });
    const item = { id: "one", bvid: "BV1234567890", title: "测试曲目", type: "mv" as const };
    track({ playId: "one", list: [item] });
    expect(calls).toEqual([]);
    track({ playId: "one", list: [{ ...item, cid: "12" }] });
    track({ playId: "one", list: [{ ...item, cid: "12", cover: "other" }] });
    expect(calls).toEqual(["one:12"]);
    track({ list: [] });
    track({ playId: "one", list: [{ ...item, cid: "12" }] });
    expect(calls).toEqual(["one:12", "one:12"]);
  });
});
