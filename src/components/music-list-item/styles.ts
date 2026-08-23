import { useLayoutMode } from "@/common/hooks/use-responsive";

export interface MusicListColumns {
  /** grid 列模板，列头与行共用，保证对齐 */
  gridCols: string;
  isMobile: boolean;
  showUp: boolean;
  showPlayCount: boolean;
  showPubTime: boolean;
  showDuration: boolean;
}

/**
 * 歌曲列表的列可见性与栅格：
 * - 桌面（≥1051px）：保持现有列
 * - 平板（821–1050px）：收掉 UP 与投稿时间
 * - 窄平板（768–820px）：再收掉播放量
 * - 移动（≤767px）：只留 序号 / 标题 / 操作
 *
 * 列头和行必须共用这一份结果，否则两边的列数会对不上、表头错位。
 */
export const useMusicListColumns = (isCompact?: boolean, hidePubTime?: boolean): MusicListColumns => {
  const mode = useLayoutMode();

  if (mode === "mobile") {
    return {
      gridCols: "grid-cols-[auto_1fr_auto]",
      isMobile: true,
      showUp: false,
      showPlayCount: false,
      showPubTime: false,
      showDuration: false,
    };
  }

  if (mode === "tablet" || mode === "narrow-tablet") {
    const showPlayCount = mode === "tablet";
    return {
      gridCols: showPlayCount ? "grid-cols-[auto_1fr_100px_80px_auto]" : "grid-cols-[auto_1fr_80px_auto]",
      isMobile: false,
      showUp: false,
      showPlayCount,
      showPubTime: false,
      showDuration: true,
    };
  }

  return {
    gridCols: isCompact
      ? hidePubTime
        ? "grid-cols-[auto_1fr_150px_100px_100px_auto]"
        : "grid-cols-[auto_1fr_150px_100px_110px_80px_auto]"
      : hidePubTime
        ? "grid-cols-[auto_1fr_100px_100px_auto]"
        : "grid-cols-[auto_1fr_100px_110px_80px_auto]",
    isMobile: false,
    showUp: Boolean(isCompact),
    showPlayCount: true,
    showPubTime: !hidePubTime,
    showDuration: true,
  };
};
