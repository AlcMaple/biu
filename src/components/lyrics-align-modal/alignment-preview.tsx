import { useEffect, useMemo, useRef } from "react";

import clsx from "classnames";

import { alignmentToLines } from "@/components/lyrics/alignment";
import { karaokeTiming } from "@/components/lyrics/karaoke";
import KaraokeText from "@/components/lyrics/karaoke-text";
import { subscribePlaybackClock, useActiveLyricIndex } from "@/components/lyrics/playback-clock";
import { usePlayList } from "@/store/play-list";

import ScrollContainer from "../scroll-container";

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, "0")}`;

interface Props {
  alignment: Pick<LyricsAlignment, "bvid" | "cid" | "lines">;
  className?: string;
}

// 只有当前播放的正是这首投稿时才跟随播放点亮，否则时间轴对不上，点亮反而误导
const AlignmentPreview = ({ alignment, className }: Props) => {
  const playItem = usePlayList(s => s.list.find(i => i.id === s.playId));
  const isCurrent = playItem?.bvid === alignment.bvid && String(playItem?.cid) === String(alignment.cid);
  const lines = useMemo(() => alignmentToLines(alignment.lines), [alignment.lines]);
  const tracked = useMemo(() => (isCurrent ? lines : []), [isCurrent, lines]);
  const activeIndex = useActiveLyricIndex(tracked, 0);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const activeTiming = useMemo(
    () => (activeIndex >= 0 ? karaokeTiming(lines[activeIndex], lines[activeIndex + 1]?.time) : null),
    [lines, activeIndex],
  );

  useEffect(() => {
    const el = activeIndex >= 0 ? lineRefs.current[activeIndex] : null;
    // 只滚列表自己：scrollIntoView 会连整页一起滚，审核员往下找「通过 / 打回」时被拽回来
    const viewport = el?.closest<HTMLElement>("[data-overlayscrollbars-viewport]");
    if (!el || !viewport) return;
    const offset = el.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    viewport.scrollTo({
      top: viewport.scrollTop + offset - viewport.clientHeight / 2 + el.clientHeight / 2,
      behavior: "smooth",
    });
  }, [activeIndex]);

  return (
    <div className={className}>
      <div className="text-foreground/60 mb-2 text-xs">
        {isCurrent ? "跟着当前播放逐字填色，点某一行可以跳过去听" : "现在播放的不是这首，先播放它才能边听边对照"}
      </div>
      <ScrollContainer className="max-h-[360px] pr-2">
        {lines.map((line, index) => (
          <div
            key={`${line.time}-${index}`}
            ref={node => {
              lineRefs.current[index] = node;
            }}
            role={isCurrent ? "button" : undefined}
            tabIndex={isCurrent ? 0 : undefined}
            onClick={isCurrent ? () => usePlayList.getState().seek(line.time / 1000) : undefined}
            className={clsx(
              "flex gap-3 rounded-md px-2 py-1 text-sm leading-relaxed",
              isCurrent && "cursor-pointer",
              index === activeIndex ? "bg-primary/10 text-foreground" : "text-foreground/70",
            )}
          >
            <span className="text-foreground/40 w-12 shrink-0 font-mono text-xs leading-6 tabular-nums">
              {fmt(line.time / 1000)}
            </span>
            <span className="min-w-0 break-words">
              {index === activeIndex && activeTiming ? (
                <KaraokeText timing={activeTiming} subscribe={subscribePlaybackClock} baseClassName="opacity-45" />
              ) : (
                line.text
              )}
            </span>
            {alignment.lines[index]?.repaired ? (
              <span className="text-warning shrink-0 text-xs leading-6">二次校准过</span>
            ) : null}
          </div>
        ))}
      </ScrollContainer>
    </div>
  );
};

export default AlignmentPreview;
