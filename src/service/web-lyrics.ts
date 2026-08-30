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
