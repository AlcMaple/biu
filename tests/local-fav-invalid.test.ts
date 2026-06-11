import { beforeEach, describe, expect, test, vi } from "vitest";

import { bv2av } from "@/common/utils/bv";
import { detectInvalidLocalFavItems } from "@/common/utils/fav";
import { type LocalFavItem, useLocalFavItemsStore } from "@/store/local-fav-items";

vi.mock("@/service/fav-resource-infos", () => ({
  getFavResourceInfos: vi.fn(),
}));

vi.mock("@/service/fav-resource", () => ({
  getFavResourceIds: vi.fn(),
}));

vi.mock("@/platform", () => ({
  default: {
    getStore: vi.fn().mockResolvedValue(null),
    setStore: vi.fn().mockResolvedValue(undefined),
    clearStore: vi.fn().mockResolvedValue(undefined),
  },
  isAndroid: false,
}));

import { getFavResourceInfos } from "@/service/fav-resource-infos";

const mockedInfos = vi.mocked(getFavResourceInfos);

const makeItem = (partial: Partial<LocalFavItem>): LocalFavItem => ({
  rid: 1,
  type: 2,
  title: "t",
  fav_time: 0,
  source: "online",
  ...partial,
});

describe("bv2av", () => {
  test("已知 avid/bvid 对照样本", () => {
    expect(bv2av("BV1xx411c7mD")).toBe(2);
    expect(bv2av("BV17x411w7KC")).toBe(170001);
    expect(bv2av("BV1Q541167Qg")).toBe(455017605);
  });
});

describe("detectInvalidLocalFavItems", () => {
  beforeEach(() => {
    mockedInfos.mockReset();
  });

  test("普通视频/音频按 rid 检测，接口未返回或 attr!=0 视为失效", async () => {
    const items = [
      makeItem({ rid: 100, type: 2, bvid: "BV1xx411c7mD" }), // avid=2，有效
      makeItem({ rid: 200, type: 2, bvid: "BV17x411w7KC" }), // avid=170001，attr=1 失效
      makeItem({ rid: 300, type: 12, ownerMid: 9, ownerName: "up" }), // 音频，接口未返回 → 失效
      makeItem({ rid: "file-1", type: 12, source: "local", audioUrl: "file://a" }), // 本地歌曲，不检测
    ];
    mockedInfos.mockResolvedValue({
      code: 0,
      message: "0",
      data: [
        { id: 2, type: 2, attr: 0 },
        { id: 170001, type: 2, attr: 1 },
      ],
    } as never);

    const { checked, invalid } = await detectInvalidLocalFavItems(items);

    expect(mockedInfos).toHaveBeenCalledTimes(1);
    const { resources } = mockedInfos.mock.calls[0][0];
    expect(resources.split(",").sort()).toEqual(["170001:2", "2:2", "300:12"]);
    expect(checked).toEqual(new Set(["100", "200", "300"]));
    expect(invalid).toEqual(new Set(["200", "300"]));
  });

  test("分集收藏（rid=cid）通过 bvid 转 avid 检测，同视频多分集共享结果", async () => {
    const items = [
      makeItem({ rid: 111111, type: 2, bvid: "BV1xx411c7mD", cid: "111111", page: 1 }),
      makeItem({ rid: 222222, type: 2, bvid: "BV1xx411c7mD", cid: "222222", page: 2 }),
    ];
    mockedInfos.mockResolvedValue({ code: 0, message: "0", data: [{ id: 2, type: 2, attr: 0 }] } as never);

    const { checked, invalid } = await detectInvalidLocalFavItems(items);

    // 同一视频只查一次 avid，而不是把 cid 当资源 id 去查（旧实现会把分集误判为失效）
    expect(mockedInfos.mock.calls[0][0].resources).toBe("2:2");
    expect(checked).toEqual(new Set(["111111", "222222"]));
    expect(invalid.size).toBe(0);
  });

  test("接口失败的分片不计入 checked，避免网络问题误判失效", async () => {
    const items = [makeItem({ rid: 100, type: 2, bvid: "BV1xx411c7mD" })];
    mockedInfos.mockResolvedValue({ code: -400, message: "error", data: null } as never);

    const { checked, invalid } = await detectInvalidLocalFavItems(items);

    expect(checked.size).toBe(0);
    expect(invalid.size).toBe(0);
  });
});

describe("updateInvalidFlags", () => {
  beforeEach(() => {
    useLocalFavItemsStore.setState({ folderItems: {} });
  });

  test("命中 invalid 打标，检测有效则清除旧标记，未检测项保持原状", () => {
    useLocalFavItemsStore.setState({
      folderItems: {
        1: [
          makeItem({ rid: 100 }),
          makeItem({ rid: 200, invalid: true }), // 资源恢复有效，应摘掉标记
          makeItem({ rid: 300, invalid: true }), // 未检测（如网络失败），保持原状
        ],
      },
    });

    useLocalFavItemsStore.getState().updateInvalidFlags(1, new Set(["100"]), new Set(["100", "200"]));

    const items = useLocalFavItemsStore.getState().folderItems[1];
    expect(items.find(i => i.rid === 100)?.invalid).toBe(true);
    expect(items.find(i => i.rid === 200)?.invalid).toBeUndefined();
    expect(items.find(i => i.rid === 300)?.invalid).toBe(true);
  });
});
