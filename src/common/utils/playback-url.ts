import { isBilibiliMediaProxyUrl } from "@shared/bilibili-web-proxy";

interface PersistedPlaybackUrls {
  audioUrl?: string;
  audioUrlCandidates?: string[];
  videoUrl?: string;
}

export function normalizePlaybackUrl(url: string | undefined, base?: string) {
  if (!url) return "";
  try {
    const fallbackBase = base ?? (typeof location === "undefined" ? "http://biu.local/" : location.href);
    return new URL(url, fallbackBase).href;
  } catch {
    return url;
  }
}

export function isSamePlaybackUrl(left: string | undefined, right: string | undefined, base?: string) {
  return Boolean(left && right) && normalizePlaybackUrl(left, base) === normalizePlaybackUrl(right, base);
}

/**
 * 同源媒体 token 只存在于当前服务进程；队列落盘时剥离，避免服务重启后先请求必然失效的旧 token。
 * BVID/CID/SID 等可重新解析标识仍保留，恢复播放时会重新向 BFF 获取地址。
 */
export function sanitizePersistedPlaybackUrls<T extends PersistedPlaybackUrls>(item: T): T {
  const audioUrl = isBilibiliMediaProxyUrl(item.audioUrl) ? undefined : item.audioUrl;
  const audioUrlCandidates = item.audioUrlCandidates?.filter(url => !isBilibiliMediaProxyUrl(url));
  const videoUrl = isBilibiliMediaProxyUrl(item.videoUrl) ? undefined : item.videoUrl;

  if (
    audioUrl === item.audioUrl &&
    videoUrl === item.videoUrl &&
    audioUrlCandidates?.length === item.audioUrlCandidates?.length
  ) {
    return item;
  }

  return {
    ...item,
    audioUrl,
    audioUrlCandidates: audioUrlCandidates?.length ? audioUrlCandidates : undefined,
    videoUrl,
  };
}
