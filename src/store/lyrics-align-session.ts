import { addToast } from "@heroui/react";
import { create } from "zustand";

import { type AlignedSource, adoptAlignment, lyricsCacheKey, previewAlignment } from "@/components/lyrics/alignment";
import platform, { log } from "@/platform";
import {
  AlignApiError,
  createAlignJob,
  discardAlignDraft,
  getAlignDraft,
  getAlignJob,
  publishAlignment,
  realignByHash,
} from "@/service/lyrics-align";
import { useAlignReview } from "@/store/align-review";
import { useLyricsState } from "@/store/lyrics-state";
import { usePlayList } from "@/store/play-list";
import { useUser } from "@/store/user";
import { ALIGN_POLL_INTERVAL_MS } from "@shared/lyrics-align";
import { StoreNameMap } from "@shared/store";

export interface AlignTarget {
  bvid: string;
  cid: string;
  title: string;
  cacheKey: string;
}

// auto = 播放时自动发起，好了直接换上；manual = 管理员手动重跑，先试听再决定采用 / 发布
export type AlignMode = "auto" | "manual";

export type AlignPhase =
  | { kind: "idle" }
  | { kind: "working"; view?: AlignJobView }
  // jobId 有值说明是查进度时失败（任务可能还在跑），可以接着查；没有就只能重新开始
  | { kind: "failed"; message: string; code?: string; jobId?: string }
  // restored = 服务器上留着的上次重跑结果（切歌回来、换设备），不是这次刚跑出来的
  | { kind: "preview"; alignment: LyricsAlignment; restored?: boolean }
  // 管理员采用了这次的结果，还没决定要不要发布给所有人
  | { kind: "adopted" };

interface AlignSessionState {
  target: AlignTarget | null;
  mode: AlignMode;
  // 送去对齐的歌词原文；从服务器恢复的草稿没有原文，重跑时改按 draftHash
  input: string;
  // 管理员手动对齐结果（服务器上的草稿）对应的歌词哈希；发布、放弃、重跑都认它
  draftHash: string | null;
  phase: AlignPhase;
  // 对齐中只能收起提示、不能取消（服务器上的任务停不下来）；进入下一阶段时重新显示
  hidden: boolean;
  auto: (lyrics: string, opts: { userChosen: boolean; immediate?: boolean }) => void;
  start: (lyrics: string) => Promise<void>;
  rerun: () => Promise<void>;
  restoreDraft: () => Promise<void>;
  resume: () => void;
  adopt: () => Promise<void>;
  discard: () => void;
  publish: () => Promise<void>;
  dismiss: () => void;
}

const show = (phase: AlignPhase) => ({ phase, hidden: false });

export const currentAlignTarget = (): AlignTarget | null => {
  const item = usePlayList.getState().getPlayItem();
  const cacheKey = lyricsCacheKey(item);
  if (!item || item.source === "local" || !item.bvid || !item.cid || !cacheKey) return null;
  return { bvid: item.bvid, cid: String(item.cid), title: item.pageTitle || item.title, cacheKey };
};

// 已经对齐过时用对齐前的原歌词：原歌词的时间用来给对齐失败的行划重对齐窗口，比拿对齐结果再对一遍可靠
export const alignInputOf = (entry?: MusicLyrics) =>
  (entry?.alignment && entry.preAlign?.lyrics) || entry?.lyrics || "";

const message = (err: unknown) => (err instanceof AlignApiError ? err.message : String(err));

// 切歌后先听一会儿再排队：连着往下切的歌不值得占服务器 2 分钟
const AUTO_DELAY_MS = 5000;

// 用户对它无能为力的失败，自动对齐时不弹提示条（日语歌每首都会碰到「暂不支持」），只记日志
const QUIET_AUTO_FAILURES = new Set(["LYRICS_UNSUPPORTED", "LYRICS_EMPTY", "LYRICS_TOO_LONG", "VIDEO_TOO_LONG"]);

// 每首歌、每份歌词，每次会话只自动发起一次；失败不自动重试（被限流时重试只会加重），换一份歌词才会再发
const autoTried = new Set<string>();

// 每次开始 / 放弃 / 切歌都换一代，上一代的计时器和轮询回来时发现代数不对就丢掉
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const stop = () => {
  generation += 1;
  clearTimeout(timer);
};

const idle = { phase: { kind: "idle" } as AlignPhase, target: null, hidden: false, draftHash: null };

const sameLines = (a?: AlignedLyricLine[], b?: AlignedLyricLine[]) =>
  Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));

export const useLyricsAlignSession = create<AlignSessionState>((set, get) => {
  const isCurrent = (target: AlignTarget) => currentAlignTarget()?.cacheKey === target.cacheKey;

  // 自动对齐好了直接换上。等待期间用户可能换了歌词：缓存里的已不是送去对齐的那份，就不覆盖
  const applyAuto = async (target: AlignTarget, alignment: LyricsAlignment, input: string, source: AlignedSource) => {
    const entry = (await platform.getStore(StoreNameMap.LyricsCache))?.[target.cacheKey];
    if (!isCurrent(target) || alignInputOf(entry).trim() !== input) return;
    const { lines, tLines } = await adoptAlignment(target.cacheKey, alignment, source);
    if (!isCurrent(target)) return;
    const lyricsState = useLyricsState.getState();
    lyricsState.setLyrics(lines, tLines);
    lyricsState.setOffset(0);
  };

  const finish = (target: AlignTarget, view: AlignJobView, gen: number, source: AlignedSource) => {
    if (gen !== generation) return;
    const { mode, input } = get();
    if (view.state === "failed") {
      const code = view.error?.code;
      if (mode === "auto" && code && QUIET_AUTO_FAILURES.has(code)) {
        log.info(`[lyrics-align] ${target.cacheKey} 不做自动对齐：${code}`);
        set(idle);
        return;
      }
      set(show({ kind: "failed", message: view.error?.message ?? "对齐失败，请稍后再试", code }));
      return;
    }
    if (!view.alignment) return;
    if (mode === "manual") {
      const { lyrics, translatedLyrics, setPreview } = useLyricsState.getState();
      setPreview(previewAlignment(view.alignment, lyrics, translatedLyrics));
      set({
        draftHash: view.alignment.lyricsHash,
        ...show({ kind: "preview", alignment: view.alignment, restored: view.draft && view.id === null }),
      });
      return;
    }
    set(idle);
    applyAuto(target, view.alignment, input, source).catch(err =>
      addToast({ title: `逐字歌词保存失败：${message(err)}`, color: "danger" }),
    );
  };

  const poll = (target: AlignTarget, jobId: string, gen: number, source: AlignedSource) => {
    timer = setTimeout(async () => {
      try {
        const view = await getAlignJob(jobId);
        if (gen !== generation) return;
        if (view.state === "queued" || view.state === "running") {
          set({ phase: { kind: "working", view } });
          poll(target, jobId, gen, source);
          return;
        }
        finish(target, view, gen, source);
      } catch (err) {
        // 查进度失败不自动重试：被限流时继续打只会更糟，交给用户决定什么时候再查
        if (gen === generation) set(show({ kind: "failed", message: message(err), jobId }));
      }
    }, ALIGN_POLL_INTERVAL_MS);
  };

  const submit = async (
    target: AlignTarget,
    text: string,
    gen: number,
    mode: AlignMode,
    source: AlignedSource,
    force = false,
  ) => {
    try {
      const view = await createAlignJob({
        bvid: target.bvid,
        cid: target.cid,
        lyrics: text,
        ...(mode === "manual" ? { manual: true, ...(force ? { force: true } : {}) } : {}),
      });
      if (gen !== generation) return;
      if (view.state === "done" || view.state === "failed") finish(target, view, gen, source);
      else if (view.id) {
        set({ phase: { kind: "working", view } });
        poll(target, view.id, gen, source);
      }
    } catch (err) {
      if (gen !== generation) return;
      set(show({ kind: "failed", message: message(err), code: err instanceof AlignApiError ? err.code : undefined }));
    }
  };

  // 失败重试、继续查询都要知道这次结果算谁的
  let lastSource: AlignedSource = "approved";

  return {
    target: null,
    mode: "auto",
    input: "",
    draftHash: null,
    phase: { kind: "idle" },
    hidden: false,

    // userChosen：用户自己选的歌词，对齐结果记成 aligned（不会被别人的版本覆盖）；否则记成 approved，随生效版本更新
    auto: (lyrics, { userChosen, immediate }) => {
      const target = currentAlignTarget();
      const text = lyrics.trim();
      // 对齐要登录：token 是拿 B 站登录换的；没登录的人照样能用别人对齐好的版本
      if (!target || !text || !useUser.getState().user?.isLogin) return;
      const { mode, phase, target: running } = get();
      // 管理员手动的那轮还没结束，不让自动对齐把它的进度和试听冲掉
      if (mode === "manual" && phase.kind !== "idle" && running?.cacheKey === target.cacheKey) return;
      const tryKey = `${target.cacheKey}\n${text}`;
      if (autoTried.has(tryKey)) return;
      stop();
      const gen = generation;
      lastSource = userChosen ? "aligned" : "approved";
      const source = lastSource;
      set({ target, mode: "auto", input: text, draftHash: null, phase: { kind: "idle" }, hidden: false });
      timer = setTimeout(
        () => {
          if (gen !== generation || !isCurrent(target)) return;
          autoTried.add(tryKey);
          // 自动对齐不出提示条：每首新歌都挂两分钟「排队中」只是打扰，好了歌词自己变成逐字的；只有需要用户处理的失败才露面
          set({ phase: { kind: "working" }, hidden: true });
          void submit(target, text, gen, "auto", source);
        },
        immediate ? 0 : AUTO_DELAY_MS,
      );
    },

    start: async lyrics => {
      const target = currentAlignTarget();
      const text = lyrics.trim();
      if (!target || !text) return;
      stop();
      const gen = generation;
      useLyricsState.getState().setPreview(null);
      set({ target, mode: "manual", input: text, draftHash: null, ...show({ kind: "working" }) });
      await submit(target, text, gen, "manual", "aligned");
    },

    // 草稿不满意时真的重跑一遍。从服务器恢复的草稿没有原文，按哈希让服务端用它存的原文重跑
    rerun: async () => {
      const { target, input, draftHash } = get();
      if (!target || (!input && !draftHash)) return;
      stop();
      const gen = generation;
      useLyricsState.getState().setPreview(null);
      set({ mode: "manual", ...show({ kind: "working" }) });
      if (input) {
        await submit(target, input, gen, "manual", "aligned", true);
        return;
      }
      try {
        const view = await realignByHash({ bvid: target.bvid, cid: target.cid, lyricsHash: draftHash! });
        if (gen !== generation) return;
        if (view.state === "done" || view.state === "failed") finish(target, view, gen, "aligned");
        else if (view.id) {
          set({ phase: { kind: "working", view } });
          poll(target, view.id, gen, "aligned");
        }
      } catch (err) {
        if (gen === generation) set(show({ kind: "failed", message: message(err) }));
      }
    },

    // 管理员切歌回来（或换了设备）时接着上次的试听，不用再等一遍对齐。草稿已采用到本机的，直接回到「待发布」
    restoreDraft: async () => {
      const target = currentAlignTarget();
      if (!target || !useAlignReview.getState().isAdmin) return;
      const busy = () => {
        const { target: running, phase } = get();
        return running?.cacheKey === target.cacheKey && phase.kind !== "idle" && get().mode === "manual";
      };
      if (busy()) return;
      let draft: AlignDraft | null;
      try {
        draft = (await getAlignDraft(target.bvid, target.cid)).draft;
      } catch (err) {
        // 查不到只是少了恢复，照常听歌；原因留在日志里
        log.warn(`[lyrics-align] ${target.cacheKey} 查询未发布的对齐结果失败`, err);
        return;
      }
      if (!draft || !isCurrent(target) || busy()) return;
      const entry = (await platform.getStore(StoreNameMap.LyricsCache))?.[target.cacheKey];
      if (!isCurrent(target) || busy()) return;
      stop();
      const base = { target, mode: "manual" as const, input: "", draftHash: draft.lyricsHash };
      if (sameLines(entry?.alignment?.lines, draft.alignment.lines)) {
        set({ ...base, ...show({ kind: "adopted" }) });
        return;
      }
      const { lyrics, translatedLyrics, setPreview } = useLyricsState.getState();
      setPreview(previewAlignment(draft.alignment, lyrics, translatedLyrics));
      set({ ...base, ...show({ kind: "preview", alignment: draft.alignment, restored: true }) });
    },

    resume: () => {
      const { target, phase, input, mode } = get();
      if (!target || phase.kind !== "failed") return;
      if (!phase.jobId && mode === "manual" && !input) {
        void get().rerun();
        return;
      }
      stop();
      set(show({ kind: "working" }));
      if (phase.jobId) poll(target, phase.jobId, generation, mode === "manual" ? "aligned" : lastSource);
      else void submit(target, input, generation, mode, mode === "manual" ? "aligned" : lastSource);
    },

    adopt: async () => {
      const { target, phase } = get();
      if (!target || phase.kind !== "preview") return;
      try {
        const { lines, tLines } = await adoptAlignment(target.cacheKey, phase.alignment, "aligned");
        const lyricsState = useLyricsState.getState();
        lyricsState.setLyrics(lines, tLines);
        lyricsState.setOffset(0);
        lyricsState.setPreview(null);
        set(show({ kind: "adopted" }));
      } catch (err) {
        addToast({ title: `歌词保存失败：${message(err)}`, color: "danger" });
      }
    },

    // 放弃要连服务器上的草稿一起删，否则下次播放这首又会被恢复成「试听中」
    discard: () => {
      const { target, draftHash } = get();
      useLyricsState.getState().setPreview(null);
      set(idle);
      if (!target || !draftHash) return;
      discardAlignDraft({ bvid: target.bvid, cid: target.cid, lyricsHash: draftHash }).catch(err =>
        addToast({ title: `已放弃，但服务器上的这份结果没删掉：${message(err)}`, color: "warning" }),
      );
    },

    publish: async () => {
      const { target, draftHash } = get();
      if (!target || !draftHash) return;
      try {
        await publishAlignment({ bvid: target.bvid, cid: target.cid, lyricsHash: draftHash });
        addToast({ title: "已发布，所有人打开这首歌都会用这份；这首歌的报错已一并关闭", color: "success" });
        set(idle);
        void useAlignReview.getState().refresh();
      } catch (err) {
        addToast({ title: message(err), color: "danger" });
      }
    },

    // 只收起提示，不取消服务器上的任务：对齐中关掉的话，好了照样会换上 / 进试听
    dismiss: () => {
      if (get().phase.kind === "working") {
        set({ hidden: true });
        return;
      }
      stop();
      useLyricsState.getState().setPreview(null);
      set(idle);
    },
  };
});

// 切歌：只跟当前这首有关，旧的计时器和轮询一并停掉（服务器上的任务照常跑完，结果缓存着，下次播放直接命中）。
// 管理员的试听和「要不要发布」只是从界面上收起：结果是服务器上的草稿，切回来由 restoreDraft 接着试听
usePlayList.subscribe((state, prevState) => {
  if (state.playId === prevState.playId) return;
  const { target } = useLyricsAlignSession.getState();
  if (!target || currentAlignTarget()?.cacheKey === target.cacheKey) return;
  stop();
  useLyricsState.getState().setPreview(null);
  useLyricsAlignSession.setState(idle);
});
