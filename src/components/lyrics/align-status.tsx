import { Spinner } from "@heroui/react";
import clsx from "classnames";

import { lyricsCacheKey } from "@/components/lyrics/alignment";
import { useLyricsAlignSession } from "@/store/lyrics-align-session";
import { useDisplayedLyrics } from "@/store/lyrics-state";
import { usePlayList } from "@/store/play-list";

const queueText = (view?: AlignJobView) => {
  if (view?.state === "queued") return view.position ? `排队中，前面 ${view.position} 首` : "排队中";
  if (view?.state === "running") return view.stage === "download" ? "获取音频中" : "约 2 分钟";
  return null;
};

// 自动对齐不出提示条（见 lyrics-align-session），听众原来分不清眼前的逐字填色是按行估算的还是对齐过的。
// 这里常驻一个只读标签说明当前状态；顶部提示条露面时它已经在说同一件事，标签就让开
const AlignStatus = () => {
  const { lyrics } = useDisplayedLyrics();
  const { target, phase, hidden } = useLyricsAlignSession();
  const currentKey = usePlayList(s => lyricsCacheKey(s.list.find(i => i.id === s.playId)));

  const isTarget = Boolean(target && target.cacheKey === currentKey);
  if (!lyrics.length || (isTarget && phase.kind !== "idle" && !hidden)) return null;

  const aligned = lyrics.some(line => line.words?.length);
  const working = isTarget && phase.kind === "working";

  let dot = "bg-white/40";
  let label = "未对齐 · 逐字按行匀速估算";
  if (aligned) {
    dot = "bg-[#1ed760]";
    label = "已对齐 · 逐字按演唱时间";
  } else if (working) {
    const extra = queueText(phase.view);
    label = extra ? `对齐中 · ${extra}` : "对齐中";
  }

  return (
    <div
      role="status"
      className="pointer-events-none absolute top-4 left-4 z-10 flex max-w-[calc(100%-2rem)] items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-2.5 py-1 text-xs leading-4 text-white/70 backdrop-blur-md"
    >
      {working && !aligned ? (
        <Spinner size="sm" color="white" classNames={{ wrapper: "size-3" }} />
      ) : (
        <span className={clsx("size-2 shrink-0 rounded-full", dot)} />
      )}
      <span className="truncate">{label}</span>
    </div>
  );
};

export default AlignStatus;
