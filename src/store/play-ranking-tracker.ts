import type { PlayData } from "./play-list";

export function createPlayRankingTracker(record: (item: PlayData) => Promise<void>) {
  let selectedId: string | undefined;
  let counted = false;
  return (state: { playId?: string; list: PlayData[] }) => {
    if (state.playId !== selectedId) {
      selectedId = state.playId;
      counted = false;
    }
    if (!selectedId || counted) return;
    const item = state.list.find(track => track.id === selectedId);
    if (!item) return;
    // 搜索点播会先切歌后补分 P；等身份齐全，避免两台设备把同一首记成两个排行条目。
    if (item.source !== "local" && item.bvid && !item.cid) return;
    counted = true;
    void record(item);
  };
}
