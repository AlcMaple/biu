import type { Media } from "@/service/user-video-archives-list";

import { useHeartbeat } from "@/store/heartbeat";
import { usePlayList, type PlayItem } from "@/store/play-list";

/** 合集/系列的 Media → 播放项（与各页「播放全部」的映射保持一致） */
export function mediaToPlayItem(m: Media): PlayItem {
  return {
    type: "mv",
    bvid: m.bvid,
    title: m.title,
    cover: m.cover,
    ownerName: m.upper?.name,
    ownerMid: m.upper?.mid,
  };
}

/**
 * 从「我的歌单」页（收藏夹/合集/系列/本地歌单）点单曲播放：
 * - 心动模式进行中 → 结束私人FM，把整队替换成该歌单（以点击项为起点）；
 * - 否则 → 常规插播。
 *
 * 只用于用户曲库里的歌单页。全网搜索/推荐/历史等浏览类页面应保持插播、保留 FM，不要用它。
 */
export function playFromFolder(clicked: PlayItem, folderMedias: PlayItem[]) {
  const hb = useHeartbeat.getState();
  if (hb.active) {
    hb.stopAndReplace(folderMedias, clicked);
    return;
  }
  void usePlayList.getState().play(clicked);
}
