import type { AiSubtitleLine } from "@shared/bilibili-subtitle";

import platform from "@/platform";

import { apiRequest } from "./request";

interface PlayerV2Response {
  code: number;
  message?: string;
  data?: {
    need_login_subtitle?: boolean;
    subtitle?: { subtitles?: { lan: string; subtitle_url: string }[] };
  };
}

export type AiSubtitleOutcome =
  | { kind: "ok"; lines: AiSubtitleLine[] }
  // 这个视频没有 AI 字幕（或字幕是空的）
  | { kind: "none" }
  | { kind: "need-login" }
  | { kind: "rate-limited" }
  | { kind: "failed"; detail: string };

// 只用 wbi/v2：旧的 x/player/v2 会返回空地址，或者别的视频的字幕（串台）。地址里没有本视频的 cid 一律不认
export async function getAiSubtitle(bvid: string, cid: string): Promise<AiSubtitleOutcome> {
  const res = await apiRequest.get<PlayerV2Response>("/x/player/wbi/v2", {
    params: { bvid, cid },
    useWbi: true,
  });
  if (res.code === -352 || res.code === -412) return { kind: "rate-limited" };
  if (res.code !== 0) return { kind: "failed", detail: `wbi/v2 code=${res.code} ${res.message ?? ""}` };
  const subtitles = res.data?.subtitle?.subtitles ?? [];
  if (!subtitles.length) return res.data?.need_login_subtitle ? { kind: "need-login" } : { kind: "none" };
  const ai = subtitles.find(s => s.lan.startsWith("ai-zh")) ?? subtitles.find(s => s.lan.startsWith("ai-"));
  if (!ai?.subtitle_url || !ai.subtitle_url.includes(cid)) return { kind: "none" };

  const body = await platform.getAiSubtitle(ai.subtitle_url);
  if (!body.ok) {
    if (body.reason === "http" && (body.status === 412 || body.status === 429)) return { kind: "rate-limited" };
    return { kind: "failed", detail: `字幕文件 ${body.reason}${body.status ? ` HTTP ${body.status}` : ""}` };
  }
  return body.lines.some(l => l.content.trim()) ? { kind: "ok", lines: body.lines } : { kind: "none" };
}
