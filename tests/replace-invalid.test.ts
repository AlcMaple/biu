import { beforeEach, describe, expect, test, vi } from "vitest";

import type { SearchVideoItem } from "@/service/web-interface-search-type";

import { applyReplacement, findAnother, isTrustedCandidate, undoReplacement } from "@/common/utils/replace-invalid";
import { type LocalFavItem, useLocalFavItemsStore } from "@/store/local-fav-items";

vi.mock("@/service/web-interface-search-type", () => ({ getWebInterfaceWbiSearchType: vi.fn() }));
vi.mock("@/platform", () => ({
  default: {
    getStore: vi.fn().mockResolvedValue(null),
    setStore: vi.fn().mockResolvedValue(undefined),
    clearStore: vi.fn().mockResolvedValue(undefined),
  },
  isAndroid: false,
}));

import { getWebInterfaceWbiSearchType } from "@/service/web-interface-search-type";

const search = vi.mocked(getWebInterfaceWbiSearchType);

const cand = (aid: number, title: string, duration: string): SearchVideoItem => ({
  aid,
  bvid: `BV${aid}`,
  title,
  author: "up",
  pic: "//x/y.jpg",
  mid: 1,
  duration,
});

const original: LocalFavItem = {
  rid: 100,
  type: 2,
  source: "online",
  bvid: "BVold",
  title: "粤语歌单｜「很久不见 到底发生过什么事」｜《到底发生过什么事》｜Dear Jane",
  duration: 260,
  fav_time: 1,
  customArtist: "我",
  invalid: true,
};

describe("isTrustedCandidate", () => {
  test("歌名对得上且时长接近才可信", () => {
    expect(isTrustedCandidate("到底发生过什么事", 260, cand(1, "Dear Jane《到底发生过什么事》", "4:21"))).toBe(true);
    expect(isTrustedCandidate("到底发生过什么事", 260, cand(2, "丁家怡《不能成情人》", "3:15"))).toBe(false);
    expect(isTrustedCandidate("到底发生过什么事", 260, cand(3, "到底发生过什么事 现场版", "6:30"))).toBe(false);
  });
});

describe("失效记录流程", () => {
  beforeEach(() => {
    useLocalFavItemsStore.setState({ folderItems: { 1: [original] }, replaceLogs: {} });
    search.mockReset();
  });

  test("换一个耗尽后还原失效项，并保留已看过的候选", async () => {
    const first = cand(1, "Dear Jane《到底发生过什么事》", "4:20");
    search.mockResolvedValue({ code: 0, data: { result: [first], numPages: 1 } } as never);
    const state = () => useLocalFavItemsStore.getState();

    applyReplacement(1, { id: "100", status: "pending", original, tried: [], time: 0, mode: "auto" }, first, "auto");
    expect(state().folderItems[1][0]).toMatchObject({ rid: 1, fav_time: 1, customArtist: "我" });
    expect(state().folderItems[1][0].invalid).toBeUndefined();

    const log = state().replaceLogs[1][0];
    expect(await findAnother(1, log)).toBe(false);
    expect(state().folderItems[1][0]).toMatchObject({ rid: 100, invalid: true, customArtist: "我" });
    expect(state().replaceLogs[1][0]).toMatchObject({ status: "pending", tried: expect.arrayContaining(["BV1"]) });
  });

  test("撤销还原为失效项", () => {
    const first = cand(1, "Dear Jane《到底发生过什么事》", "4:20");
    applyReplacement(1, { id: "100", status: "pending", original, tried: [], time: 0, mode: "auto" }, first, "auto");
    undoReplacement(1, useLocalFavItemsStore.getState().replaceLogs[1][0]);
    expect(useLocalFavItemsStore.getState().folderItems[1][0]).toMatchObject({ rid: 100, invalid: true });
  });
});
