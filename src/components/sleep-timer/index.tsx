import { useEffect, useRef, useState } from "react";

import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from "@heroui/react";
import { RiCheckboxBlankCircleLine, RiCheckboxCircleFill, RiTimerLine } from "@remixicon/react";
import clx from "classnames";

import { useIsMobileLayout } from "@/common/hooks/use-responsive";
import IconButton from "@/components/icon-button";
import {
  isSleepTimerActive,
  SLEEP_TIMER_DEFAULT_MINUTES,
  SLEEP_TIMER_MAX_MINUTES,
  SLEEP_TIMER_PRESETS,
  useSleepTimer,
} from "@/store/sleep-timer";

const formatRemain = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

const useRemain = () => {
  const endAt = useSleepTimer(s => s.endAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endAt]);
  return endAt === null ? null : endAt - now;
};

const parseMinutes = (value: string) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= SLEEP_TIMER_MAX_MINUTES ? n : null;
};

const CustomRow = ({ active }: { active: boolean }) => {
  const minutes = useSleepTimer(s => s.minutes);
  const isCustom = useSleepTimer(s => s.isCustom);
  const start = useSleepTimer(s => s.start);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const parsed = parseMinutes(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const submit = () => {
    if (parsed === null) return;
    start(parsed, true);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="border-content3 flex min-h-[54px] items-center gap-2.5 border-t px-3.5 py-2.5">
        <label className="bg-content3 focus-within:ring-primary flex h-[34px] min-w-0 flex-1 items-center rounded-full px-3.5 focus-within:ring-1">
          <input
            ref={inputRef}
            type="number"
            inputMode="numeric"
            min={1}
            max={SLEEP_TIMER_MAX_MINUTES}
            placeholder={`1–${SLEEP_TIMER_MAX_MINUTES}`}
            aria-label="自定义分钟数"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") submit();
            }}
            className="placeholder:text-foreground-500 min-w-0 flex-1 appearance-none bg-transparent text-[15px] tabular-nums outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-foreground-500 flex-none text-[13px]">分钟</span>
        </label>
        <button
          type="button"
          className="text-foreground-500 h-[34px] flex-none px-1 text-[13px]"
          onClick={() => setEditing(false)}
        >
          取消
        </button>
        <Button
          size="sm"
          radius="full"
          color="primary"
          isDisabled={parsed === null}
          onPress={submit}
          className="h-[34px] flex-none px-4 font-semibold"
        >
          确定
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={clx(
        "border-content3 flex min-h-[54px] w-full items-center justify-center border-t px-3.5 text-sm",
        active && isCustom ? "text-primary" : "text-foreground-500",
      )}
      onClick={() => {
        setValue(isCustom && minutes ? String(minutes) : "");
        setEditing(true);
      }}
    >
      {active && isCustom ? `自定义 · ${minutes} 分钟` : "自定义"}
    </button>
  );
};

const SleepTimerPanel = () => {
  const minutes = useSleepTimer(s => s.minutes);
  const isCustom = useSleepTimer(s => s.isCustom);
  const pending = useSleepTimer(s => s.pending);
  const waitSongEnd = useSleepTimer(s => s.waitSongEnd);
  const active = useSleepTimer(isSleepTimerActive);
  const start = useSleepTimer(s => s.start);
  const cancel = useSleepTimer(s => s.cancel);
  const setWaitSongEnd = useSleepTimer(s => s.setWaitSongEnd);
  const remain = useRemain();

  const status = pending ? "播完这首后暂停" : remain !== null ? `${formatRemain(remain)} 后暂停` : "";

  return (
    <div className="flex w-full flex-col">
      <div className="text-foreground-500 px-1 pb-2.5 text-sm">定时关闭</div>
      <div className="bg-content2 rounded-xl">
        <div className="flex items-center justify-between px-3.5 py-3">
          <div>
            <div className="text-[15px] font-semibold">选择时间</div>
            <div className="text-primary mt-0.5 min-h-4 text-xs tabular-nums">{status}</div>
          </div>
          <Switch
            size="sm"
            aria-label="定时关闭"
            isSelected={active}
            onValueChange={on => (on ? start(minutes ?? SLEEP_TIMER_DEFAULT_MINUTES, isCustom) : cancel())}
          />
        </div>
        <div className="grid grid-cols-6 gap-2 px-3.5 pb-3.5">
          {SLEEP_TIMER_PRESETS.map(m => (
            <button
              key={m}
              type="button"
              className={clx(
                "aspect-square rounded-full text-[15px] tabular-nums",
                active && !isCustom && minutes === m ? "bg-primary text-black" : "bg-content3",
              )}
              onClick={() => start(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <CustomRow active={active} />
      </div>
      <button
        type="button"
        className="flex items-center justify-center gap-2 px-1 pt-3.5 pb-1 text-[13px]"
        onClick={() => setWaitSongEnd(!waitSongEnd)}
      >
        {waitSongEnd ? (
          <RiCheckboxCircleFill size={20} className="text-primary" />
        ) : (
          <RiCheckboxBlankCircleLine size={20} className="text-foreground-500" />
        )}
        播完整首歌再停止播放
      </button>
    </div>
  );
};

const SleepTimerButton = () => {
  const isMobileLayout = useIsMobileLayout();
  const active = useSleepTimer(isSleepTimerActive);
  const pending = useSleepTimer(s => s.pending);
  const remain = useRemain();
  const [open, setOpen] = useState(false);

  const trigger = (
    <IconButton
      aria-label="定时关闭"
      onPress={isMobileLayout ? () => setOpen(true) : undefined}
      className={clx("flex-none", active && "text-primary", active && !isMobileLayout && "w-auto min-w-fit gap-1 px-2")}
    >
      <RiTimerLine size={18} />
      {active && !isMobileLayout && (
        <span className="min-w-[38px] text-left text-xs tabular-nums">
          {pending ? "本首后" : formatRemain(remain ?? 0)}
        </span>
      )}
    </IconButton>
  );

  if (isMobileLayout) {
    return (
      <>
        {trigger}
        <Drawer isOpen={open} onOpenChange={setOpen} placement="bottom" hideCloseButton>
          <DrawerContent className="pb-[var(--safe-bottom)]">
            <DrawerBody className="px-4 pt-3.5 pb-7">
              <SleepTimerPanel />
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover placement="top" isOpen={open} onOpenChange={setOpen}>
      <PopoverTrigger>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[340px] p-3">
        <SleepTimerPanel />
      </PopoverContent>
    </Popover>
  );
};

export default SleepTimerButton;
