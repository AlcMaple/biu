import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Button, Input, Spinner, Textarea, addToast } from "@heroui/react";

import { adoptAlignment, lyricsCacheKey, restorePreAlign } from "@/components/lyrics/alignment";
import platform from "@/platform";
import { AlignApiError, createAlignJob, getAlignJob, getApprovedLyrics, submitLyrics } from "@/service/lyrics-align";
import { type LyricLine, useLyricsState } from "@/store/lyrics-state";
import { ALIGN_POLL_INTERVAL_MS } from "@shared/lyrics-align";
import { StoreNameMap } from "@shared/store";

import AlignmentPreview from "./alignment-preview";

type Phase =
  | { kind: "idle" }
  | { kind: "working"; view?: AlignJobView }
  // jobId 有值说明是轮询途中失败（任务可能还在跑），可以接着查；没有就只能重新提交
  | { kind: "error"; message: string; jobId?: string }
  | { kind: "done"; alignment: LyricsAlignment; lyrics: string };

export interface AlignTarget {
  bvid: string;
  cid: string;
  title: string;
}

interface Props {
  target: AlignTarget;
  initialLyrics: string;
  onAdopted: (lines: LyricLine[], tLines: LyricLine[]) => void;
}

const message = (err: unknown) => (err instanceof AlignApiError ? err.message : String(err));

const progressText = (view?: AlignJobView) => {
  if (!view || view.state === "done") return "正在提交…";
  if (view.state === "queued") return `排队中，前面还有 ${view.position ?? "?"} 首`;
  if (view.stage === "download") return "正在从 B 站获取音频…";
  return "正在分离人声并对齐，一首大约 2 分钟…";
};

const AlignTab = ({ target, initialLyrics, onAdopted }: Props) => {
  const [text, setText] = useState(initialLyrics);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [approved, setApproved] = useState<LyricsAlignment | null>(null);
  const [hasPreAlign, setHasPreAlign] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"adopt" | "submit" | "restore" | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const cacheKey = lyricsCacheKey({ bvid: target.bvid, cid: target.cid });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    getApprovedLyrics(target.bvid, target.cid)
      .then(res => !canceled && setApproved(res.alignment))
      // 这里只是提示「已有审核版本」，查不到不挡对齐；真正的错误在用户点对齐时会原样显示
      .catch(() => {});
    if (cacheKey) {
      platform.getStore(StoreNameMap.LyricsCache).then(store => {
        if (!canceled) setHasPreAlign(Boolean(store?.[cacheKey]?.alignment && store[cacheKey].preAlign));
      });
    }
    return () => {
      canceled = true;
    };
  }, [target.bvid, target.cid, cacheKey]);

  const poll = useCallback((id: string, lyrics: string) => {
    timerRef.current = setTimeout(async () => {
      try {
        const view = await getAlignJob(id);
        if (!aliveRef.current) return;
        if (view.state === "done" && view.alignment) {
          setPhase({ kind: "done", alignment: view.alignment, lyrics });
        } else if (view.state === "failed") {
          setPhase({ kind: "error", message: view.error?.message ?? "对齐失败" });
        } else {
          setPhase({ kind: "working", view });
          poll(id, lyrics);
        }
      } catch (err) {
        // 轮询失败不自动重试：被限流时继续打只会更糟，交给用户决定什么时候再查
        if (aliveRef.current) setPhase({ kind: "error", message: message(err), jobId: id });
      }
    }, ALIGN_POLL_INTERVAL_MS);
  }, []);

  const start = async () => {
    const lyrics = text.trim();
    if (!lyrics) return;
    setPhase({ kind: "working" });
    try {
      const view = await createAlignJob({ bvid: target.bvid, cid: target.cid, lyrics });
      if (!aliveRef.current) return;
      if (view.state === "done" && view.alignment) {
        setPhase({ kind: "done", alignment: view.alignment, lyrics });
      } else if (view.state === "failed") {
        setPhase({ kind: "error", message: view.error?.message ?? "对齐失败" });
      } else if (view.id) {
        setPhase({ kind: "working", view });
        poll(view.id, lyrics);
      }
    } catch (err) {
      if (aliveRef.current) setPhase({ kind: "error", message: message(err) });
    }
  };

  const resume = (jobId: string) => {
    setPhase({ kind: "working" });
    poll(jobId, text.trim());
  };

  const adopt = async (alignment: LyricsAlignment, source: "aligned" | "approved") => {
    if (!cacheKey) return;
    setBusy("adopt");
    try {
      const { lines, tLines, hasPreAlign: kept } = await adoptAlignment(cacheKey, alignment, source);
      setHasPreAlign(kept);
      onAdopted(lines, tLines);
      addToast({ title: "已采用逐字歌词", color: "success" });
    } catch (err) {
      addToast({ title: `歌词保存失败：${message(err)}`, color: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!cacheKey) return;
    setBusy("restore");
    try {
      const restored = await restorePreAlign(cacheKey);
      setHasPreAlign(false);
      if (restored) useLyricsState.getState().setLyrics(restored.lines, restored.tLines);
      addToast({ title: "已还原为对齐前的歌词", color: "success" });
    } catch (err) {
      addToast({ title: `还原失败：${message(err)}`, color: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const submit = async (lyrics: string) => {
    setBusy("submit");
    try {
      await submitLyrics({ bvid: target.bvid, cid: target.cid, lyrics, note: note.trim() || undefined });
      addToast({
        title: "已提交审核，通过后这首歌对所有人生效",
        description: "审核结果在侧边栏「我的提交」里查看",
        color: "success",
      });
      setNote("");
    } catch (err) {
      addToast({ title: message(err), color: "danger" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {approved ? (
        <Alert
          color="success"
          title="这首歌已有审核通过的逐字歌词"
          description={`${approved.lines.length} 行，所有人打开这首歌时默认使用`}
          endContent={
            <Button
              size="sm"
              color="success"
              variant="flat"
              isLoading={busy === "adopt"}
              onPress={() => adopt(approved, "approved")}
            >
              直接使用
            </Button>
          }
        />
      ) : null}

      {hasPreAlign ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-foreground/60">当前在用的是对齐后的歌词</span>
          <Button size="sm" variant="flat" isLoading={busy === "restore"} onPress={restore}>
            还原为对齐前
          </Button>
        </div>
      ) : null}

      {phase.kind === "done" ? (
        <>
          <div className="text-foreground/70 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>{phase.alignment.lines.length} 行</span>
            <span>置信度中位数 {phase.alignment.quality.medianScore.toFixed(2)}</span>
            {phase.alignment.quality.repairedLines ? (
              <span>局部重对齐 {phase.alignment.quality.repairedLines} 行</span>
            ) : null}
            {phase.alignment.offsetSec ? <span>比原歌词整体偏移 {phase.alignment.offsetSec.toFixed(2)} 秒</span> : null}
          </div>
          <AlignmentPreview alignment={phase.alignment} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="light" onPress={() => setPhase({ kind: "idle" })}>
              改歌词重新对齐
            </Button>
            <Button color="primary" isLoading={busy === "adopt"} onPress={() => adopt(phase.alignment, "aligned")}>
              采用
            </Button>
          </div>
          <div className="border-default-200 flex flex-col gap-2 border-t pt-3">
            <div className="text-sm">觉得准，可以提交给审核员，通过后所有人打开这首歌都用这份歌词</div>
            <div className="flex gap-2">
              <Input
                size="sm"
                value={note}
                onValueChange={setNote}
                placeholder="备注（可选），比如歌词来源"
                maxLength={200}
              />
              <Button variant="flat" isLoading={busy === "submit"} onPress={() => submit(phase.lyrics)}>
                提交审核
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <Textarea
            value={text}
            onValueChange={setText}
            minRows={8}
            maxRows={14}
            isDisabled={phase.kind === "working"}
            placeholder="粘贴歌词（带时间的 LRC 或纯文本都行），或先在「搜索歌词」里选一份再点自动对齐"
          />
          {phase.kind === "working" ? (
            <div className="text-foreground/70 flex items-center gap-2 text-sm">
              <Spinner size="sm" />
              {progressText(phase.view)}
              <span className="text-foreground/40">
                关掉窗口不影响服务器继续对齐，稍后用同一份歌词再点一次即可拿到结果
              </span>
            </div>
          ) : null}
          {phase.kind === "error" ? (
            <Alert
              color="danger"
              title={phase.message}
              endContent={
                phase.jobId ? (
                  <Button size="sm" variant="flat" color="danger" onPress={() => resume(phase.jobId!)}>
                    继续查询
                  </Button>
                ) : null
              }
            />
          ) : null}
          <div className="flex justify-end">
            <Button color="primary" isDisabled={!text.trim() || phase.kind === "working"} onPress={start}>
              {phase.kind === "error" && !phase.jobId ? "重新对齐" : "开始对齐"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default AlignTab;
