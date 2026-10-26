import { ProviderTransportError, type ProviderTransport } from "./lyrics-providers.js";

export interface AiSubtitleLine {
  from: number;
  to: number;
  content: string;
}

export type AiSubtitleResult =
  | { ok: true; lines: AiSubtitleLine[] }
  | { ok: false; reason: "invalid-url" | "http" | "timeout" | "network" | "bad-body"; status?: number };

const HOST = "aisubtitle.hdslb.com";
const PATH = /^\/bfs\/ai_subtitle\/[A-Za-z0-9_./-]+$/;
const AUTH_KEY = /^[A-Za-z0-9-]+$/;

// 只认 B 站 AI 字幕 CDN 上的字幕文件、只带 auth_key：这条通道在 Web 版是服务端转发，放开任意地址就是开放代理
export function aiSubtitleTarget(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
  } catch {
    return null;
  }
  if (url.hostname !== HOST || !PATH.test(url.pathname) || url.username || url.password || url.port) return null;
  if ([...url.searchParams.keys()].some(k => k !== "auth_key")) return null;
  const authKey = url.searchParams.get("auth_key");
  if (authKey !== null && !AUTH_KEY.test(authKey)) return null;
  url.protocol = "https:";
  url.hash = "";
  return url;
}

const isLine = (item: unknown): item is AiSubtitleLine => {
  const { from, to, content } = (item ?? {}) as Record<string, unknown>;
  return typeof from === "number" && typeof to === "number" && typeof content === "string";
};

export async function fetchAiSubtitle(transport: ProviderTransport, raw: string): Promise<AiSubtitleResult> {
  const url = aiSubtitleTarget(raw);
  if (!url) return { ok: false, reason: "invalid-url" };
  try {
    const res = await transport({
      method: "GET",
      url,
      headers: { Accept: "application/json", Referer: "https://www.bilibili.com/" },
    });
    if (res.status < 200 || res.status >= 300) return { ok: false, reason: "http", status: res.status };
    const body = (JSON.parse(res.text) as { body?: unknown }).body;
    if (!Array.isArray(body)) return { ok: false, reason: "bad-body" };
    return {
      ok: true,
      lines: body.filter(isLine).map(({ from, to, content }) => ({ from, to, content })),
    };
  } catch (error) {
    if (error instanceof ProviderTransportError) return { ok: false, reason: error.kind };
    return { ok: false, reason: "bad-body" };
  }
}
