import { type ReactNode, useState } from "react";

import { Button, Spinner } from "@heroui/react";
import { RiCloseLine, RiErrorWarningLine } from "@remixicon/react";

import { lyricsCacheKey } from "@/components/lyrics/alignment";
import { useLyricsAlignSession } from "@/store/lyrics-align-session";
import { usePlayList } from "@/store/play-list";

const progressText = (view?: AlignJobView) => {
  if (!view || view.state === "done") return "正在生成逐字歌词…";
  if (view.state === "queued") return view.position ? `逐字歌词排队中，前面还有 ${view.position} 首` : "逐字歌词排队中";
  if (view.stage === "download") return "正在获取这首歌的音频…";
  return "正在逐字对齐，大约 2 分钟";
};

const offsetText = (sec: number) => {
  if (Math.abs(sec) < 0.3) return null;
  return `原歌词整体${sec > 0 ? "快" : "慢"}了 ${Math.abs(sec).toFixed(1)} 秒，已校正`;
};

interface Props {
  // 歌词和音频对不上时，换一份歌词（选好就会自动再对齐）
  onSearchLyrics: () => void;
  onUploadLyrics: () => void;
}

// 浮在歌词区顶部，和桌面歌词工具条同一套玻璃样式（半透明黑底 + 细白边 + 模糊），沉浸式界面里不另起一种卡片
const AlignBar = ({ onSearchLyrics, onUploadLyrics }: Props) => {
  const { target, phase, hidden } = useLyricsAlignSession();
  const currentKey = usePlayList(s => lyricsCacheKey(s.list.find(i => i.id === s.playId)));
  const [busy, setBusy] = useState(false);

  if (phase.kind === "idle" || hidden || !target || currentKey !== target.cacheKey) return null;

  const session = useLyricsAlignSession.getState();
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const flat = (label: string, onPress: () => void) => (
    <Button size="sm" radius="full" variant="flat" className="text-white" onPress={onPress}>
      {label}
    </Button>
  );

  let icon: ReactNode = null;
  let title = "";
  let detail: string | null = null;
  let actions: ReactNode = null;

  if (phase.kind === "working") {
    icon = <Spinner size="sm" color="white" />;
    title = progressText(phase.view);
    detail = "管理员重跑，好了先试听";
  } else if (phase.kind === "failed") {
    icon = <RiErrorWarningLine size={18} className="text-warning shrink-0" />;
    title = phase.message;
    // 歌词配错时原样重试只会再配错一次，所以只给「换一份歌词」；被下线的那份重跑也一样，只能换一份上传
    actions = phase.jobId
      ? flat("继续查询", session.resume)
      : phase.code === "LYRICS_MISMATCH" || phase.code === "AUDIO_TOO_SHORT"
        ? flat("换一份歌词", onSearchLyrics)
        : phase.code === "ALIGNMENT_WITHDRAWN"
          ? flat("上传我的歌词", onUploadLyrics)
          : flat("重试", session.resume);
  } else if (phase.kind === "preview") {
    title = "正在试听这次的对齐结果";
    detail = offsetText(phase.alignment.offsetSec);
    actions = (
      <>
        <Button
          size="sm"
          radius="full"
          variant="light"
          className="text-white/80"
          isDisabled={busy}
          onPress={session.discard}
        >
          放弃
        </Button>
        <Button size="sm" radius="full" color="primary" isLoading={busy} onPress={() => run(session.adopt)}>
          采用
        </Button>
      </>
    );
  } else {
    title = "已换成这次的对齐结果";
    detail = "确认没问题可以发布，替换所有人在用的版本";
    actions = (
      <Button size="sm" radius="full" color="primary" isLoading={busy} onPress={() => run(session.publish)}>
        发布给所有人
      </Button>
    );
  }

  return (
    <div className="pointer-events-auto absolute top-4 left-1/2 z-20 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-3xl border border-white/15 bg-black/45 px-4 py-2 text-white shadow-lg backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <div className="min-w-0">
          <div className="text-sm leading-5">{title}</div>
          {detail ? <div className="text-xs leading-4 text-white/60">{detail}</div> : null}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {actions}
        {phase.kind !== "preview" ? (
          <Button
            isIconOnly
            size="sm"
            radius="full"
            variant="light"
            aria-label={phase.kind === "working" ? "收起提示，对齐继续进行" : "关闭"}
            className="-mr-2 min-w-0 text-white/60"
            onPress={session.dismiss}
          >
            <RiCloseLine size={16} />
          </Button>
        ) : null}
      </div>
    </div>
  );
};

export default AlignBar;
