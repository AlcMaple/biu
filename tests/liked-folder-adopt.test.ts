import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/platform", () => ({
  default: {
    getStore: vi.fn().mockResolvedValue(null),
    setStore: vi.fn().mockResolvedValue(undefined),
    clearStore: vi.fn().mockResolvedValue(undefined),
  },
  isAndroid: false,
}));

import { LIKED_FOLDER_ID, LIKED_FOLDER_TITLE } from "@/common/constants/heartbeat";
import { ensureLikedFolder, useFavoritesStore } from "@/store/favorite";
import { type LocalFavItem, useLocalFavItemsStore } from "@/store/local-fav-items";

const makeItem = (partial: Partial<LocalFavItem>): LocalFavItem => ({
  rid: 1,
  type: 2,
  title: "t",
  fav_time: 0,
  source: "online",
  ...partial,
});

const resetStores = () => {
  useFavoritesStore.setState({
    createdFavorites: [],
    collectedFavorites: [],
    createdOrder: [],
    collectedOrder: [],
  });
  useLocalFavItemsStore.setState({ folderItems: {} });
};

describe("mergeFolder", () => {
  beforeEach(resetStores);

  test("并入目标夹，按 rid 去重、保留各自原 fav_time，并删除源夹", () => {
    useLocalFavItemsStore.setState({
      folderItems: {
        [-2]: [makeItem({ rid: 1, fav_time: 100 }), makeItem({ rid: 2, fav_time: 200 })],
        [LIKED_FOLDER_ID]: [makeItem({ rid: 2, fav_time: 999 }), makeItem({ rid: 3, fav_time: 300 })],
      },
    });

    useLocalFavItemsStore.getState().mergeFolder(-2, LIKED_FOLDER_ID);

    const { folderItems } = useLocalFavItemsStore.getState();
    expect(folderItems[-2]).toBeUndefined();
    const merged = folderItems[LIKED_FOLDER_ID];
    expect(merged).toHaveLength(3);
    // rid=2 冲突时保留目标夹已有项（fav_time 999），不被源夹覆盖
    expect(merged.find(i => i.rid === 2)?.fav_time).toBe(999);
    expect(merged.find(i => i.rid === 1)?.fav_time).toBe(100);
    expect(merged.find(i => i.rid === 3)?.fav_time).toBe(300);
  });

  test("源夹不存在时不改动", () => {
    useLocalFavItemsStore.setState({ folderItems: { [LIKED_FOLDER_ID]: [makeItem({ rid: 3 })] } });
    useLocalFavItemsStore.getState().mergeFolder(-999, LIKED_FOLDER_ID);
    expect(useLocalFavItemsStore.getState().folderItems[LIKED_FOLDER_ID]).toHaveLength(1);
  });
});

describe("ensureLikedFolder 采用（adopt）同名旧歌单", () => {
  beforeEach(resetStores);

  test("同名本地旧歌单：歌曲并入 -1、删除旧歌单、复用旧封面，最终唯一", () => {
    const oldId = -1772066364647;
    useFavoritesStore.setState({
      createdFavorites: [{ id: oldId, title: LIKED_FOLDER_TITLE, cover: "old.jpg", isLocal: true }],
      createdOrder: [oldId],
    });
    useLocalFavItemsStore.setState({
      folderItems: { [oldId]: [makeItem({ rid: 10, fav_time: 1 }), makeItem({ rid: 11, fav_time: 2 })] },
    });

    ensureLikedFolder();

    const liked = useFavoritesStore.getState().createdFavorites.filter(f => f.title === LIKED_FOLDER_TITLE);
    expect(liked).toHaveLength(1);
    expect(liked[0].id).toBe(LIKED_FOLDER_ID);
    expect(liked[0].isDefault).toBe(true);
    expect(liked[0].cover).toBe("old.jpg");
    expect(useLocalFavItemsStore.getState().folderItems[oldId]).toBeUndefined();
    expect(useLocalFavItemsStore.getState().folderItems[LIKED_FOLDER_ID]).toHaveLength(2);
  });

  test("已重复态：空的 -1 + 同名旧歌单 → 合并为唯一且带内容/封面", () => {
    const oldId = -1772066364647;
    useFavoritesStore.setState({
      createdFavorites: [
        { id: LIKED_FOLDER_ID, title: LIKED_FOLDER_TITLE, type: 11, isLocal: true, isDefault: true },
        { id: oldId, title: LIKED_FOLDER_TITLE, cover: "old.jpg", isLocal: true },
      ],
      createdOrder: [LIKED_FOLDER_ID, oldId],
    });
    useLocalFavItemsStore.setState({ folderItems: { [oldId]: [makeItem({ rid: 10 })] } });

    ensureLikedFolder();

    const created = useFavoritesStore.getState().createdFavorites;
    expect(created.filter(f => f.title === LIKED_FOLDER_TITLE)).toHaveLength(1);
    expect(created.find(f => f.id === oldId)).toBeUndefined();
    expect(created.find(f => f.id === LIKED_FOLDER_ID)?.cover).toBe("old.jpg");
    expect(useLocalFavItemsStore.getState().folderItems[LIKED_FOLDER_ID]).toHaveLength(1);
  });

  test("无同名旧歌单：仅确保默认 -1 存在，且幂等", () => {
    ensureLikedFolder();
    expect(useFavoritesStore.getState().createdFavorites.filter(f => f.id === LIKED_FOLDER_ID)).toHaveLength(1);

    ensureLikedFolder();
    const created = useFavoritesStore.getState().createdFavorites;
    expect(created.filter(f => f.id === LIKED_FOLDER_ID)).toHaveLength(1);
    expect(created.filter(f => f.title === LIKED_FOLDER_TITLE)).toHaveLength(1);
  });

  test("已有独立命名的本地歌单不受影响", () => {
    ensureLikedFolder();
    useFavoritesStore.getState().addCreatedFavorite({ id: -555, title: "沉浸", isLocal: true });

    ensureLikedFolder();

    const created = useFavoritesStore.getState().createdFavorites;
    expect(created.find(f => f.id === -555)?.title).toBe("沉浸");
    expect(created.filter(f => f.title === LIKED_FOLDER_TITLE)).toHaveLength(1);
  });
});
