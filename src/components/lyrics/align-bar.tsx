import { type ReactNode, useState } from "react";

import { Button, Input, Popover, PopoverContent, PopoverTrigger, Spinner } from "@heroui/react";
import { RiCloseLine, RiErrorWarningLine } from "@remixicon/react";

import { lyricsCacheKey } from "@/components/lyrics/alignment";
import { useLyricsAlignSession } from "@/store/lyrics-align-session";
import { usePlayList } from "@/store/play-list";

const progressText = (view?: AlignJobView) => {
  if (!view || view.state === "done") return "正在提交对齐…";
  if (view.state === "queued") return view.position ? `排队中，前面还有 ${view.position} 首` : "排队中";
  if (view.stage === "download") return "正在获取这首歌的音频…";
  return "正在逐字对齐，大约 2 分钟";
};

const offsetText = (sec: number) => {
  if (Math.abs(sec) < 0.3) return null;
  return `原歌词整体${sec > 0 ? "快" : "慢"}了 ${Math.abs(sec).toFixed(1)} 秒，已校正`;
};

// 浮在歌词区顶部，和桌面歌词工具条同一套玻璃样式（半透明黑底 + 细白边 + 模糊），沉浸式界面里不另起一种卡片
const AlignBar = ({ onEditLyrics }: { onEditLyrics: () => void }) => {
  const { target, phase, hidden, input } = useLyricsAlignSession();
  const currentKey = usePlayList(s => lyricsCacheKey(s.list.find(i => i.id === s.playId)));
  const [note, setNote] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // 对齐中切到别的歌：任务照常跑，提示只在那首歌上显示
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

  let icon: ReactNode = null;
  let title = "";
  let detail: string | null = null;
  let actions: ReactNode = null;

  if (phase.kind === "working") {
    icon = <Spinner size="sm" color="white" />;
    title = progressText(phase.view);
    detail = "可以接着听歌，好了会自动换上试听";
  } else if (phase.kind === "failed") {
    icon = <RiErrorWarningLine size={18} className="text-warning shrink-0" />;
    title = phase.message;
    // 歌词配错时原样重试只会再配错一次，还照扣当天次数，所以只给「换一份歌词」
    actions = phase.jobId ? (
      <Button size="sm" radius="full" variant="flat" className="text-white" onPress={session.resume}>
        继续查询
      </Button>
    ) : phase.code === "LYRICS_MISMATCH" ? (
      <Button size="sm" radius="full" variant="flat" className="text-white" onPress={onEditLyrics}>
        换一份歌词
      </Button>
    ) : (
      <Button size="sm" radius="full" variant="flat" className="text-white" onPress={() => void session.start(input)}>
        重试
      </Button>
    );
  } else if (phase.kind === "preview") {
    const approved = phase.source === "approved";
    title = approved ? "这首歌有审核通过的逐字歌词，正在试听" : "正在试听逐字歌词";
    detail = approved ? null : offsetText(phase.alignment.offsetSec);
    actions = (
      <>
        <Button
          size="sm"
          radius="full"
          variant="light"
          className="text-white/80"
          isDisabled={busy}
          onPress={() => (approved ? void session.start(input, { skipApproved: true }) : session.discard())}
        >
          {approved ? "用我的歌词对齐" : "放弃"}
        </Button>
        <Button size="sm" radius="full" color="primary" isLoading={busy} onPress={() => run(session.adopt)}>
          采用
        </Button>
      </>
    );
  } else {
    title = "已换成逐字歌词";
    detail = "听着准的话，可以提交给审核员，通过后所有人打开这首歌都用它";
    actions = (
      <Popover placement="bottom" isOpen={submitOpen} onOpenChange={setSubmitOpen} disableAnimation>
        <PopoverTrigger>
          <Button size="sm" radius="full" color="primary">
            提交审核
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3">
          <div className="flex w-full flex-col gap-2">
            <Input
              size="sm"
              value={note}
              onValueChange={setNote}
              placeholder="备注（可选），比如歌词出处"
              maxLength={200}
            />
            <Button
              size="sm"
              color="primary"
              isLoading={busy}
              onPress={() =>
                run(async () => {
                  if (await session.submit(note)) {
                    setNote("");
                    setSubmitOpen(false);
                  }
                })
              }
            >
              提交
            </Button>
          </div>
        </PopoverContent>
      </Popover>
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
