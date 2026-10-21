export const WEB_LYRICS_PROXY_ROOT = "/__biu_lyrics";

export const WEB_LYRICS_PROXY_PATHS = {
  lrclibSearch: `${WEB_LYRICS_PROXY_ROOT}/lrclib/search`,
  neteaseAudioMatch: `${WEB_LYRICS_PROXY_ROOT}/netease/audio-match`,
  neteaseLyrics: `${WEB_LYRICS_PROXY_ROOT}/netease/lyrics`,
  neteaseSearch: `${WEB_LYRICS_PROXY_ROOT}/netease/search`,
  providerSearch: `${WEB_LYRICS_PROXY_ROOT}/provider/search`,
  providerGet: `${WEB_LYRICS_PROXY_ROOT}/provider/get`,
} as const;
