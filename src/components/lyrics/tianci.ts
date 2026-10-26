import type { LyricLine } from "@/store/lyrics-state";

import { log } from "@/platform";
import { getAiSubtitle } from "@/service/ai-subtitle";
import { AlignApiError, createScreenJob, getRecognizedLyrics, getScreenJob } from "@/service/lyrics-align";
import { useLyricsState } from "@/store/lyrics-state";
import { useUser } from "@/store/user";
import { ALIGN_POLL_INTERVAL_MS } from "@shared/lyrics-align";

// 填词歌（旋律沿用原曲、歌词整首重写的同人二创）在歌词平台上搜不到；标题里写的原曲名反而会被当成歌名，配上原曲的歌词。
// 标题带这些标记就不按标题搜，直接从视频画面识别。偶尔有标题写「原曲」的普通翻唱也会走这条路，结果仍是画面上的歌词，一般不会更差
const TIANCI_MARKS = /填词|填翻|改词|原曲|替换/;

export const looksLikeTianci = (title: string) => TIANCI_MARKS.test(title);

export type ScreenOriginKind = ScreenOrigin["kind"];

const normalize = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();

// 来源跟着歌词文字走：用户换了歌词、或生效版本换成别人上传的，文字对不上就不再提示来源
export const screenOriginOf = (kind: ScreenOriginKind, lyrics: string): ScreenOrigin => ({
  kind,
  text: normalize(lyrics.replace(/\[[^\]]*\]/g, "")),
});

export const matchesScreenOrigin = (lines: LyricLine[], origin: ScreenOrigin | undefined | null) =>
  Boolean(origin && lines.length && normalize(lines.map(l => l.text).join("")) === origin.text);

export interface ScreenHit {
  lyrics: string;
  tLyrics?: string;
  kind: ScreenOriginKind;
}

const RATE_LIMITED_TEXT = "识别请求太频繁，请稍后再试。";

const fail = (message: string) => {
  useLyricsState.getState().setScreenStatus({ kind: "failed", message });
  return null;
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// 读服务端已识别的结果；只认画面识别任务写的两种来源
async function readScreenResult(bvid: string, cid: string, v: number): Promise<ScreenHit | null> {
  const shared = await getRecognizedLyrics(bvid, cid);
  const rec = shared.recognized;
  if (!rec || (shared.v ?? 0) < v) return null;
  if (rec.from === "subtitle") return { lyrics: rec.lyrics, kind: "subtitle" };
  if (rec.from === "screen") {
    return { lyrics: rec.lyrics, tLyrics: rec.tLyrics ?? undefined, kind: rec.confident ? "screen" : "screen-unsure" };
  }
  return null;
}

// 拉 B 站 AI 字幕（要登录，走各端现有的登录请求通道）→ 交给对齐服务器从画面识别 → 读回共享结果。
// 失败如实写进歌词区的状态，不自动重试（AGENTS.md「网络请求」）。切歌后停止轮询，服务器照常跑完并存下结果
export async function recognizeFromScreen(
  bvid: string,
  cid: string,
  v: number,
  isCanceled: () => boolean,
): Promise<ScreenHit | null> {
  const { setScreenStatus } = useLyricsState.getState();
  if (!useUser.getState().user) {
    log.info("[lyrics] 填词歌识别跳过：本地没有登录态");
    return fail("登录后可自动识别填词歌歌词。");
  }
  setScreenStatus({ kind: "working" });
  let stage: "subtitle" | "server" = "subtitle";
  try {
    const sub = await getAiSubtitle(bvid, cid);
    if (isCanceled()) return null;
    if (sub.kind === "need-login") {
      log.warn("[lyrics] B 站说要登录才能看 AI 字幕", bvid, cid);
      return fail("登录后可自动识别填词歌歌词。");
    }
    if (sub.kind === "rate-limited") return fail(RATE_LIMITED_TEXT);
    if (sub.kind === "failed") {
      log.warn("[lyrics] 获取 B 站 AI 字幕失败", sub.detail);
      return fail("获取 B 站 AI 字幕失败，暂时无法识别歌词。");
    }

    stage = "server";
    let job = await createScreenJob({
      bvid,
      cid,
      v,
      // 没有 AI 字幕时传空，服务端只靠画面认歌词（素演、英文坏女孩这类）
      subtitle: (sub.kind === "ok" ? sub.lines : []).map(l => ({
        from: l.from,
        to: l.to,
        content: l.content.slice(0, 200),
      })),
    });
    while (job.id && (job.state === "queued" || job.state === "running")) {
      await sleep(ALIGN_POLL_INTERVAL_MS);
      if (isCanceled()) return null;
      job = await getScreenJob(job.id);
    }
    if (isCanceled()) return null;
    if (job.state === "failed") return fail(job.error?.message ?? "识别视频画面失败，请稍后再试。");

    const hit = await readScreenResult(bvid, cid, v);
    setScreenStatus(null);
    return hit;
  } catch (err) {
    if (isCanceled()) return null;
    if (err instanceof AlignApiError) {
      if (err.status === 429) return fail(RATE_LIMITED_TEXT);
      return fail(err.message);
    }
    log.warn("[lyrics] 从视频画面识别歌词失败", stage, err);
    return fail(
      stage === "subtitle" ? "获取 B 站 AI 字幕失败，暂时无法识别歌词。" : "连不上歌词识别服务，请稍后再试。",
    );
  }
}
