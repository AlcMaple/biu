import type {
  ProviderLyricsCandidate,
  ProviderLyricsDocument,
  ProviderLyricsGetParams,
  ProviderLyricsSearchParams,
  ProviderResult,
} from "@shared/lyrics-providers";

import { WEB_LYRICS_PROXY_PATHS } from "@shared/web-lyrics-proxy";

import { axiosInstance } from "./request";

export function searchWebNeteaseSongs(params: SearchSongByNeteaseParams): Promise<SearchSongByNeteaseResponse> {
  return axiosInstance.get<SearchSongByNeteaseResponse>(WEB_LYRICS_PROXY_PATHS.neteaseSearch, { params });
}

export function getWebNeteaseLyrics(params: GetLyricsByNeteaseParams): Promise<GetLyricsByNeteaseResponse> {
  return axiosInstance.get<GetLyricsByNeteaseResponse>(WEB_LYRICS_PROXY_PATHS.neteaseLyrics, { params });
}

export function searchWebLrclibLyrics(params: SearchSongByLrclibParams): Promise<SearchSongByLrclibResponse[]> {
  return axiosInstance.get<SearchSongByLrclibResponse[]>(WEB_LYRICS_PROXY_PATHS.lrclibSearch, { params });
}

export function matchWebNeteaseAudio(params: NeteaseAudioMatchParams): Promise<NeteaseAudioMatchResponse> {
  return axiosInstance.get<NeteaseAudioMatchResponse>(WEB_LYRICS_PROXY_PATHS.neteaseAudioMatch, { params });
}

// BFF 把渠道错误也放在 200 的 ok:false 里，渲染层能区分限流 / 未收录 / 格式不支持
export function searchWebProviderLyrics(
  params: ProviderLyricsSearchParams,
): Promise<ProviderResult<ProviderLyricsCandidate[]>> {
  return axiosInstance.get(WEB_LYRICS_PROXY_PATHS.providerSearch, { params });
}

export function getWebProviderLyrics(params: ProviderLyricsGetParams): Promise<ProviderResult<ProviderLyricsDocument>> {
  return axiosInstance.get(WEB_LYRICS_PROXY_PATHS.providerGet, { params });
}
