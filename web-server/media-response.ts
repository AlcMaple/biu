import { isAllowedBilibiliMediaUrl, normalizeBilibiliMediaSource } from "./routes.js";

const MEDIA_SINGLE_URL_KEYS = new Set(["baseUrl", "base_url", "url"]);
const MEDIA_URL_ARRAY_KEYS = new Set(["backupUrl", "backup_url", "cdns"]);
const MEDIA_RESPONSE_PATHS = new Set(["/audio/music-service-c/url", "/x/player/playurl", "/x/player/wbi/playurl"]);

export function isBilibiliMediaResponse(target: URL) {
  return MEDIA_RESPONSE_PATHS.has(target.pathname);
}

export function rewriteBilibiliMediaPayload(
  payload: unknown,
  register: (target: string) => string | undefined,
): { payload: unknown; rewritten: number } {
  let rewritten = 0;
  const registered = new Map<string, string>();

  const rewriteUrl = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    const normalized = normalizeBilibiliMediaSource(value);
    if (!normalized || !isAllowedBilibiliMediaUrl(normalized)) return undefined;

    const existing = registered.get(normalized);
    if (existing) return existing;

    const proxyUrl = register(normalized);
    if (!proxyUrl) return undefined;
    registered.set(normalized, proxyUrl);
    rewritten += 1;
    return proxyUrl;
  };

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;

    const object = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(object)) {
      if (MEDIA_SINGLE_URL_KEYS.has(key)) {
        object[key] = rewriteUrl(child) ?? "";
        continue;
      }

      if (MEDIA_URL_ARRAY_KEYS.has(key)) {
        object[key] = Array.isArray(child)
          ? child.map(item => rewriteUrl(item)).filter((item): item is string => Boolean(item))
          : [];
        continue;
      }

      object[key] = visit(child);
    }
    return object;
  };

  return { payload: visit(payload), rewritten };
}
