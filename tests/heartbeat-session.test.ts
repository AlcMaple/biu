import { beforeEach, describe, expect, test, vi } from "vitest";

/** 假的 platform store：模拟重启（内存 store 归零、磁盘 store 还在） */
const disk: Record<string, any> = {};

vi.mock("@/platform", () => ({
  default: {
    getStore: vi.fn(async (name: string) => disk[name] ?? null),
    setStore: vi.fn(async (name: string, value: any) => {
      disk[name] = value;
    }),
    clearStore: vi.fn(async (name: string) => {
      delete disk[name];
    }),
    updatePlaybackState: vi.fn(),
  },
  isAndroid: false,
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/common/utils/audio", () => ({
  getAudioUrl: vi.fn(async () => ({ audioUrl: "https://audio.test/a.mp3", isLossless: false })),
  getDashUrl: vi.fn(async () => ({ audioUrl: "https://video.test/a.mp3", isLossless: false })),
  isUrlValid: vi.fn((url: string) => typeof url === "string" && url.length > 0),
  isResourceGoneCode: () => false,
}));

vi.mock("@/service/audio-song-info", () => ({ getAudioSongInfo: vi.fn(async () => ({})) }));
vi.mock("@/service/web-interface-view", () => ({ getWebInterfaceView: vi.fn(async () => ({})) }));
vi.mock("@/service/heartbeat/candidate-engine", () => ({
  buildCandidatePool: vi.fn(async () => []),
  clearHeartbeatCache: vi.fn(),
}));

import { restoreSession, useHeartbeat } from "@/store/heartbeat";
import { usePlayList } from "@/store/play-list";
import { StoreNameMap } from "@shared/store";

const song = (id: string) => ({ id, title: `song-${id}`, type: "mv" as const, bvid: `BV${id}` });

/** 模拟重启：内存 store 归零，磁盘 store（disk）保持不动 */
const simulateRestart = (queue: string[]) => {
  useHeartbeat.setState({
    active: false,
    loading: false,
    servedBvids: new Set(),
    servedKeys: new Set(),
    sessionIds: new Set(),
  });
  usePlayList.setState({ list: queue.map(song), playId: queue[0] });
};

beforeEach(() => {
  for (const k of Object.keys(disk)) delete disk[k];
  vi.clearAllMocks();
});

describe("重启后恢复心动会话", () => {
  test("队列仍是上次 FM 的 → 恢复会话，并载回已推历史（续供靠它去重）", async () => {
    disk[StoreNameMap.HeartbeatSession] = { active: true, sessionIds: ["a", "b"] };
    disk[StoreNameMap.HeartbeatServed] = { bvids: ["BVold"], keys: ["k1"] };
    simulateRestart(["a", "b"]);

    await restoreSession();

    const hb = useHeartbeat.getState();
    expect(hb.active).toBe(true);
    expect(hb.sessionIds.has("a")).toBe(true);
    expect(hb.isSessionLive()).toBe(true);
    // 不载回已推历史的话，续供会把听过的重新推一遍
    expect(hb.servedBvids.has("BVold")).toBe(true);
    expect(hb.servedKeys.has("k1")).toBe(true);
  });

  test("退出前点了别的歌单（队列已整队替换）→ 不恢复，并清掉磁盘上的会话标记", async () => {
    disk[StoreNameMap.HeartbeatSession] = { active: true, sessionIds: ["a", "b"] };
    simulateRestart(["x", "y"]); // 队列 id 全变 = 已离场

    await restoreSession();

    expect(useHeartbeat.getState().active).toBe(false);
    expect(disk[StoreNameMap.HeartbeatSession]).toEqual({ active: false, sessionIds: [] });
  });

  test("上次退出前已停止 FM（active=false）→ 不恢复", async () => {
    disk[StoreNameMap.HeartbeatSession] = { active: false, sessionIds: [] };
    simulateRestart(["a"]);

    await restoreSession();

    expect(useHeartbeat.getState().active).toBe(false);
  });

  test("从没开过 FM（磁盘无记录）→ 不恢复，且不报错", async () => {
    simulateRestart(["a"]);

    await restoreSession();

    expect(useHeartbeat.getState().active).toBe(false);
  });

  test("FM 中搜索插播过（队列 = 会话歌 + 新插的歌）→ 仍算在场，照常恢复", async () => {
    disk[StoreNameMap.HeartbeatSession] = { active: true, sessionIds: ["a", "b"] };
    simulateRestart(["a", "b", "inserted"]);

    await restoreSession();

    expect(useHeartbeat.getState().active).toBe(true);
  });

  test("已在会话中 → 不重复恢复（避免重复挂续供订阅）", async () => {
    disk[StoreNameMap.HeartbeatSession] = { active: true, sessionIds: ["a"] };
    simulateRestart(["a"]);
    useHeartbeat.setState({ active: true, sessionIds: new Set(["keep"]) });

    await restoreSession();

    expect(useHeartbeat.getState().sessionIds.has("keep")).toBe(true);
  });
});

describe("会话状态落盘", () => {
  test("stop() 清掉磁盘上的会话标记，重启后不会误恢复", async () => {
    simulateRestart(["a"]);
    useHeartbeat.setState({ active: true, sessionIds: new Set(["a"]) });

    useHeartbeat.getState().stop();

    expect(disk[StoreNameMap.HeartbeatSession]).toEqual({ active: false, sessionIds: [] });
    // 走一遍重启：不该恢复
    simulateRestart(["a"]);
    await restoreSession();
    expect(useHeartbeat.getState().active).toBe(false);
  });
});

describe("isSessionLive", () => {
  test("active 且队列里还有本会话的歌 → 在场", () => {
    simulateRestart(["a", "b"]);
    useHeartbeat.setState({ active: true, sessionIds: new Set(["a", "b"]) });
    expect(useHeartbeat.getState().isSessionLive()).toBe(true);
  });

  test("队列被整队替换 → 离场（只看 active 会误判：歌单页「播放全部」不走 stopAndReplace）", () => {
    simulateRestart(["x"]);
    useHeartbeat.setState({ active: true, sessionIds: new Set(["a", "b"]) });
    expect(useHeartbeat.getState().isSessionLive()).toBe(false);
  });

  test("未开始 FM → 离场", () => {
    simulateRestart(["a"]);
    useHeartbeat.setState({ active: false, sessionIds: new Set(["a"]) });
    expect(useHeartbeat.getState().isSessionLive()).toBe(false);
  });
});
