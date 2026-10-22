import { type ReactNode, useState } from "react";

import { Button, Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { RiAlertLine, RiArrowDownSLine } from "@remixicon/react";
import clsx from "classnames";
import { motion } from "framer-motion";

import { useIsMobileLayout } from "@/common/hooks/use-responsive";
import { lyricsCacheKey } from "@/components/lyrics/alignment";
import { useLyricsAlignSession } from "@/store/lyrics-align-session";
import { useDisplayedLyrics } from "@/store/lyrics-state";
import { usePlayList } from "@/store/play-list";

const DOT_GREEN = "#1ed760";
const DOT_AMBER = "#e5b94e";

const offsetText = (sec: number) => {
  if (Math.abs(sec) < 0.3) return null;
  return `原歌词整体${sec > 0 ? "快" : "慢"}了 ${Math.abs(sec).toFixed(1)} 秒，已校正`;
};

interface Props {
  // 歌词和音频对不上时，换一份歌词（选好就会自动再对齐）
  onSearchLyrics: () => void;
  onUploadLyrics: () => void;
  onOpenChange?: (open: boolean) => void;
}

interface View {
  dot: ReactNode;
  label: string;
  hint?: string;
  caution?: boolean;
  progress?: boolean;
  title: string;
  body: string;
  actions?: ReactNode;
}

const Dot = ({ color, hollow }: { color?: string; hollow?: boolean }) => (
  <span
    className="size-2 shrink-0 rounded-full"
    style={hollow ? { border: `1.5px solid ${color ?? "rgb(255 255 255 / 0.55)"}` } : { background: color }}
  />
);

// 和桌面歌词工具条同一套玻璃样式（半透明底 + 细白边），放在播放器顶栏右端，不占歌词区。
// 标签只放不超过 8 个字的状态词，细节收进点开的小面板：Web 版没有悬停，不能靠 Tooltip 才看得到原因
const AlignChip = ({ onSearchLyrics, onUploadLyrics, onOpenChange }: Props) => {
  const { lyrics } = useDisplayedLyrics();
  const { target, mode, phase } = useLyricsAlignSession();
  const currentKey = usePlayList(s => lyricsCacheKey(s.list.find(i => i.id === s.playId)));
  const isMobileLayout = useIsMobileLayout();
  const [busy, setBusy] = useState(false);

  const isTarget = Boolean(target && target.cacheKey === currentKey);
  const active = isTarget && phase.kind !== "idle";
  if (!lyrics.length && !active) return null;

  const session = useLyricsAlignSession.getState();
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const act = (label: string, onPress: () => void, primary = false) => (
    <Button
      key={label}
      size="sm"
      radius="full"
      color={primary ? "primary" : "default"}
      variant={primary ? "solid" : "flat"}
      className={primary ? "dark:text-black" : undefined}
      isLoading={primary && busy}
      isDisabled={!primary && busy}
      onPress={onPress}
    >
      {label}
    </Button>
  );

  let view: View;
  if (active && phase.kind === "working") {
    const job = phase.view;
    const queued = job?.state === "queued";
    const downloading = job?.state === "running" && job.stage === "download";
    view = {
      dot: <Dot color={DOT_GREEN} hollow />,
      label: queued ? "排队" : downloading ? "获取音频" : "对齐中",
      hint: queued ? (job.position ? `前 ${job.position} 首` : undefined) : downloading ? undefined : "约 2 分钟",
      progress: true,
      title: queued ? "逐字歌词排队中" : "正在逐字对齐",
      body:
        (queued && job.position ? `前面还有 ${job.position} 首。` : "") +
        "好了之后歌词会自动变成逐字点亮，不用手动操作。" +
        (mode === "manual" ? "这是管理员重跑，好了先试听再决定是否采用。" : ""),
    };
  } else if (active && phase.kind === "failed") {
    // 歌词配错时原样重试只会再配错一次，所以只给「换一份歌词」；被下线的那份重跑也一样，只能换一份上传
    const next = phase.jobId
      ? act("继续查询", session.resume, true)
      : phase.code === "LYRICS_MISMATCH" || phase.code === "AUDIO_TOO_SHORT"
        ? act("换一份歌词", onSearchLyrics, true)
        : phase.code === "ALIGNMENT_WITHDRAWN"
          ? act("上传我的歌词", onUploadLyrics, true)
          : act("重试", session.resume, true);
    view = {
      dot: <RiAlertLine size={14} style={{ color: DOT_AMBER }} />,
      label: "对齐失败",
      caution: true,
      title: "没能逐字对齐",
      body: phase.message,
      actions: (
        <>
          {act("关闭", session.dismiss)}
          {next}
        </>
      ),
    };
  } else if (active && phase.kind === "preview") {
    view = {
      dot: <Dot color={DOT_GREEN} hollow />,
      label: "试听中",
      title: "正在试听这次的对齐结果",
      body: offsetText(phase.alignment.offsetSec) ?? "确认没问题就采用，不满意可以放弃。",
      actions: (
        <>
          {act("放弃", session.discard)}
          {act("采用", () => run(session.adopt), true)}
        </>
      ),
    };
  } else if (active && phase.kind === "adopted") {
    view = {
      dot: <Dot color={DOT_GREEN} />,
      label: "待发布",
      title: "已换成这次的对齐结果",
      body: "确认没问题可以发布，替换所有人在用的版本。",
      actions: act("发布给所有人", () => run(session.publish), true),
    };
  } else {
    const aligned = lyrics.some(line => line.words?.length && !line.nativeWords);
    // 平台逐字是原唱录音的时间，翻唱 / 现场 / 剪辑版会错开，不能显示成「已对齐」
    const native = !aligned && lyrics.some(line => line.nativeWords);
    view = aligned
      ? {
          dot: <Dot color={DOT_GREEN} />,
          label: "已对齐",
          title: "逐字歌词已对齐",
          body: "逐字点亮按真实的演唱时间走。",
        }
      : native
        ? {
            dot: <Dot color={DOT_AMBER} />,
            label: "原唱时间",
            hint: "翻唱可能有偏差",
            title: "逐字时间来自原唱",
            body: "这份逐字时间取自歌词平台的原唱录音。翻唱、现场或剪辑版可能会错开。",
          }
        : {
            dot: <Dot hollow />,
            label: "未对齐",
            hint: "估算",
            title: "逐字为估算",
            body: "逐字点亮按每行的时长匀速估算，不是真实的演唱时间。登录后播放时会自动对齐；暂不支持的语种或歌词会一直保持估算。",
          };
  }

  return (
    <Popover placement="bottom-end" onOpenChange={onOpenChange}>
      <PopoverTrigger>
        <Button
          size="sm"
          radius="full"
          variant="bordered"
          disableAnimation
          aria-label={`逐字歌词状态：${view.label}${view.hint ? `，${view.hint}` : ""}`}
          className={clsx(
            "relative h-7 min-w-0 shrink-0 gap-1.5 overflow-hidden bg-white/5 px-2.5 text-xs font-normal text-white/80 backdrop-blur-md",
            view.caution ? "border-[#e5b94e]/45" : "border-white/15",
          )}
        >
          {view.dot}
          <span className="font-medium text-white">{view.label}</span>
          {view.hint && !isMobileLayout ? <span className="text-white/50">{view.hint}</span> : null}
          {view.caution ? <RiArrowDownSLine size={12} className="text-white/50" /> : null}
          {view.progress ? (
            <motion.span
              className="absolute bottom-0 left-0 h-0.5 w-1/3 bg-[#1ed760]"
              initial={{ x: "-100%" }}
              animate={{ x: "300%" }}
              transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
            />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 items-stretch gap-1 p-3.5">
        <div className="text-small font-medium">{view.title}</div>
        <p className="text-tiny text-default-500 leading-relaxed">{view.body}</p>
        {view.actions ? <div className="mt-2 flex justify-end gap-2">{view.actions}</div> : null}
      </PopoverContent>
    </Popover>
  );
};

export default AlignChip;
