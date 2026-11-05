import { expect, it, vi } from "vitest";

import type { PlaylistPartitionData } from "@/platform/web-playlist-partition";
import type { FavoriteItem } from "@/store/favorite";

const stores = vi.hoisted(() => ({ favorite: vi.fn(), items: vi.fn(), tags: vi.fn() }));
vi.mock("@/store/favorite", () => ({ useFavoritesStore: { setState: stores.favorite } }));
vi.mock("@/store/local-fav-items", () => ({ useLocalFavItemsStore: { setState: stores.items } }));
vi.mock("@/store/tags", () => ({ useTagStore: { setState: stores.tags } }));

import { applyWebPlaylistPartition } from "@/service/web-playlist-view";

it("并入后保留当前账号在线收藏夹、排序与原页面字段", () => {
  const data: PlaylistPartitionData = {
    favorites: {
      createdFavorites: [{ id: -1, title: "我喜欢的音乐", isLocal: true }],
      createdOrder: [-1, 100, 100, 999],
      collectedOrder: [200],
    },
    items: { folderItems: { [-1]: [] }, replaceLogs: {} },
    tags: { tags: [], itemTags: {} },
  };
  applyWebPlaylistPartition(data);
  const transform = stores.favorite.mock.calls[0][0] as (state: {
    createdFavorites: FavoriteItem[];
    createdOrder: number[];
  }) => { createdFavorites: FavoriteItem[]; createdOrder: number[] };
  const result = transform({
    createdFavorites: [
      { id: -1, title: "旧本地", isLocal: true },
      { id: 100, title: "在线默认夹" },
      { id: 101, title: "在线音乐夹" },
    ],
    createdOrder: [101, 100, -1],
  });
  expect(result.createdFavorites.map(item => item.id)).toEqual([-1, 100, 101]);
  expect(result.createdOrder).toEqual([-1, 100, 101]);
  expect(stores.items).toHaveBeenCalledWith(data.items);
  expect(stores.tags).toHaveBeenCalledWith(data.tags);
});
