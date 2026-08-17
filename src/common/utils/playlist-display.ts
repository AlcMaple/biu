import type { PlayData } from "@/store/play-list";

type PlayListIdentity = Pick<PlayData, "id" | "type" | "source" | "bvid" | "cid" | "sid">;

/**
 * 播放列表抽屉的去重身份。
 *
 * 同一视频的不同分集必须保留：本地收藏夹会把每个分集作为独立歌曲保存，
 * 只按 bvid 去重会把其中一个分集从抽屉中隐藏，造成「歌单 213、播放列表 212」的假象。
 */
export const getPlayListDisplayKey = (item: PlayListIdentity) => {
  if (item.source === "local") return `local:${item.id}`;
  if (item.type === "mv") return `mv:${item.bvid ?? ""}:${item.cid ?? ""}`;
  return `audio:${item.sid ?? ""}`;
};

export const isSamePlayListDisplayItem = (first?: PlayListIdentity, second?: PlayListIdentity) => {
  return Boolean(first && second && getPlayListDisplayKey(first) === getPlayListDisplayKey(second));
};
