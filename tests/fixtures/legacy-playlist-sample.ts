import { StoreNameMap } from "@shared/store";

// 曲目来自既有离线目录；fav_time为固定毫秒、duration为秒，不代表真实使用年限。
export const legacyPlaylistSample = () => ({
  [StoreNameMap.LocalFavorites]: {
    createdFavorites: [
      { id: -1, title: "我喜欢的音乐", isLocal: true },
      { id: -77, title: "旧版晚间", isLocal: true },
    ],
    createdOrder: [-77, -1],
    collectedOrder: [],
  },
  [StoreNameMap.LocalFavItems]: {
    folderItems: {
      [-1]: [
        {
          rid: 100002,
          type: 2,
          bvid: "BV1DEMO00003",
          source: "online",
          title: "旧版·Apologize",
          ownerName: "OneRepublic",
          ownerMid: 20002,
          duration: 226,
          fav_time: 1700000000000,
        },
      ],
      [-77]: [
        {
          rid: 100001,
          type: 2,
          bvid: "BV1DEMO00002",
          source: "online",
          title: "旧版·梦醒时分",
          ownerName: "陈淑桦",
          customArtist: "旧版自定歌手",
          duration: 209,
          fav_time: 1700000000001,
        },
      ],
    },
  },
  [StoreNameMap.Tags]: {
    tags: [{ id: 7, name: "旧版标签", color: "#22c55e" }],
    itemTags: { "video:bvid:BV1DEMO00003": [7] },
  },
});
