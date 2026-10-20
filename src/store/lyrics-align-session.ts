import { addToast } from "@heroui/react";
import { create } from "zustand";

import { type AlignedSource, adoptAlignment, lyricsCacheKey, previewAlignment } from "@/components/lyrics/alignment";
import { log } from "@/platform";
import { AlignApiError, createAlignJob, getAlignJob, getApprovedLyrics, submitLyrics } from "@/service/lyrics-align";
import { useLyricsState } from "@/store/lyrics-state";
import { usePlayList } from "@/store/play-list";
import { ALIGN_POLL_INTERVAL_MS } from "@shared/lyrics-align";

export interface AlignTarget {
  bvid: string;
  cid: string;
  title: string;
  cacheKey: string;
}

export type AlignPhase =
  | { kind: "idle" }
  | { kind: "working"; view?: AlignJobView }
  // jobId 有值说明是查进度时失败（任务可能还在跑），可以接着查；没有就只能重新开始
  | { kind: "failed"; message: string; code?: string; jobId?: string }
  | { kind: "preview"; alignment: LyricsAlignment; source: AlignedSource }
  // 采用了自己的对齐结果，还没决定要不要提交审核
  | { kind: "adopted" };

interface AlignSessionState {
  target: AlignTarget | null;
  // 送去对齐的歌词原文；提交审核要用同一份，服务端按它的指纹认缓存
  input: string;
  phase: AlignPhase;
  // 对齐中只能收起提示、不能取消（服务器上的任务停不下来）；进入下一阶段时重新显示
  hidden: boolean;
  start: (lyrics: string, opts?: { skipApproved?: boolean }) => Promise<void>;
  resume: () => void;
  adopt: () => Promise<void>;
  discard: () => void;
  submit: (note?: string) => Promise<boolean>;
  dismiss: () => void;
}

const show = (phase: AlignPhase) => ({ phase, hidden: false });

export const currentAlignTarget = (): AlignTarget | null => {
  const item = usePlayList.getState().getPlayItem();
  const cacheKey = lyricsCacheKey(item);
  if (!item || item.source === "local" || !item.bvid || !item.cid || !cacheKey) return null;
  return { bvid: item.bvid, cid: String(item.cid), title: item.pageTitle || item.title, cacheKey };
};

const message = (err: unknown) => (err instanceof AlignApiError ? err.message : String(err));

// 每次开始 / 放弃 / 关闭都换一代，上一代的轮询回来时发现代数不对就丢掉
let generation = 0;
let pollTimer: ReturnType<typeof setTimeout> | undefined;

const stopPolling = () => {
  generation += 1;
  clearTimeout(pollTimer);
};

export const useLyricsAlignSession = create<AlignSessionState>((set, get) => {
  const isCurrent = (target: AlignTarget) => currentAlignTarget()?.cacheKey === target.cacheKey;

  const enterPreview = (alignment: LyricsAlignment, source: AlignedSource) => {
    const { lyrics, translatedLyrics, setPreview } = useLyricsState.getState();
    setPreview(previewAlignment(alignment, lyrics, translatedLyrics));
    set(show({ kind: "preview", alignment, source }));
    if (source === "aligned") addToast({ title: "逐字歌词好了，正在试听", color: "success" });
  };

  const finish = (target: AlignTarget, view: AlignJobView) => {
    if (view.state === "failed") {
      set(show({ kind: "failed", message: view.error?.message ?? "对齐失败，请稍后再试", code: view.error?.code }));
      return;
    }
    if (!view.alignment) return;
    if (isCurrent(target)) {
      enterPreview(view.alignment, "aligned");
      return;
    }
    // 结果已经缓存在服务器上，再点一次直接命中、不排队也不占次数
    set({ phase: { kind: "idle" }, target: null });
    addToast({
      title: `「${target.title}」的逐字歌词好了`,
      description: "切回这首歌，再点一次「对齐当前歌词」就能直接用",
      color: "success",
    });
  };

  const poll = (target: AlignTarget, jobId: string, gen: number) => {
    pollTimer = setTimeout(async () => {
      try {
        const view = await getAlignJob(jobId);
        if (gen !== generation) return;
        if (view.state === "queued" || view.state === "running") {
          if (isCurrent(target)) set({ phase: { kind: "working", view } });
          poll(target, jobId, gen);
          return;
        }
        finish(target, view);
      } catch (err) {
        // 查进度失败不自动重试：被限流时继续打只会更糟，交给用户决定什么时候再查
        if (gen === generation) set(show({ kind: "failed", message: message(err), jobId }));
      }
    }, ALIGN_POLL_INTERVAL_MS);
  };

  return {
    target: null,
    input: "",
    phase: { kind: "idle" },
    hidden: false,

    start: async (lyrics, opts) => {
      const target = currentAlignTarget();
      const text = lyrics.trim();
      if (!target || !text) return;
      stopPolling();
      const gen = generation;
      useLyricsState.getState().setPreview(null);
      set({ target, input: text, ...show({ kind: "working" }) });

      if (!opts?.skipApproved) {
        try {
          const { alignment } = await getApprovedLyrics(target.bvid, target.cid);
          if (gen !== generation) return;
          if (alignment) {
            enterPreview(alignment, "approved");
            return;
          }
        } catch (err) {
          // 只是想省一次排队；查不到照常对齐，真有问题下面的对齐请求会把原因报出来
          log.warn("[lyrics-align] 查询审核通过的歌词失败", err);
        }
      }

      try {
        const view = await createAlignJob({ bvid: target.bvid, cid: target.cid, lyrics: text });
        if (gen !== generation) return;
        if (view.state === "done" || view.state === "failed") finish(target, view);
        else if (view.id) {
          set(show({ kind: "working", view }));
          poll(target, view.id, gen);
        }
      } catch (err) {
        if (gen === generation)
          set(
            show({ kind: "failed", message: message(err), code: err instanceof AlignApiError ? err.code : undefined }),
          );
      }
    },

    resume: () => {
      const { target, phase } = get();
      if (!target || phase.kind !== "failed" || !phase.jobId) return;
      stopPolling();
      set(show({ kind: "working" }));
      poll(target, phase.jobId, generation);
    },

    adopt: async () => {
      const { target, phase } = get();
      if (!target || phase.kind !== "preview") return;
      try {
        const { lines, tLines } = await adoptAlignment(target.cacheKey, phase.alignment, phase.source);
        const lyricsState = useLyricsState.getState();
        lyricsState.setLyrics(lines, tLines);
        lyricsState.setOffset(0);
        lyricsState.setPreview(null);
        set(show(phase.source === "aligned" ? { kind: "adopted" } : { kind: "idle" }));
      } catch (err) {
        addToast({ title: `歌词保存失败：${message(err)}`, color: "danger" });
      }
    },

    discard: () => {
      useLyricsState.getState().setPreview(null);
      set({ phase: { kind: "idle" }, target: null });
    },

    submit: async note => {
      const { target, input } = get();
      if (!target) return false;
      try {
        await submitLyrics({ bvid: target.bvid, cid: target.cid, lyrics: input, note: note?.trim() || undefined });
        addToast({
          title: "已提交，审核通过后所有人都会用这份歌词",
          description: "审核结果在侧边栏「我的提交」里",
          color: "success",
        });
        set({ phase: { kind: "idle" }, target: null });
        return true;
      } catch (err) {
        addToast({ title: message(err), color: "danger" });
        return false;
      }
    },

    // 只收起提示，不取消服务器上的任务：对齐中关掉的话，好了照样会提示
    dismiss: () => {
      if (get().phase.kind === "working") {
        set({ hidden: true });
        return;
      }
      stopPolling();
      useLyricsState.getState().setPreview(null);
      set({ phase: { kind: "idle" }, target: null });
    },
  };
});

// 切歌时试听和「要不要提交」都作废（没采用就等于放弃）；还在对齐的任务继续跑，好了用提示告诉用户
usePlayList.subscribe((state, prevState) => {
  if (state.playId === prevState.playId) return;
  {
    const { phase, target } = useLyricsAlignSession.getState();
    if (phase.kind === "working" || phase.kind === "idle") return;
    if (target && currentAlignTarget()?.cacheKey === target.cacheKey) return;
    stopPolling();
    useLyricsState.getState().setPreview(null);
    useLyricsAlignSession.setState({ phase: { kind: "idle" }, target: null });
  }
});
