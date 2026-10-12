import got from "got";

import { UserAgent } from "../../network/user-agent";

export function getSongByNetease(params: SearchSongByNeteaseParams) {
  return got
    .get("https://interface.music.163.com/api/search/get", {
      searchParams: {
        ...params,
      },
      timeout: { request: 10000 },
      retry: { limit: 3 },
      headers: {
        Referer: "https://music.163.com/",
        origin: "https://music.163.com",
        "user-agent": UserAgent,
      },
    })
    .json<SearchSongByNeteaseResponse>();
}

export function getLyricsByNetease(params: GetLyricsByNeteaseParams) {
  return got
    .get("https://interface.music.163.com/api/song/lyric", {
      searchParams: {
        ...params,
        tv: -1,
        lv: -1,
        rv: -1,
        kv: -1,
        _nmclfl: 1,
      },
      timeout: { request: 10000 },
      retry: { limit: 3 },
      headers: {
        Referer: "https://music.163.com/",
        origin: "https://music.163.com",
        "user-agent": UserAgent,
      },
    })
    .json<GetLyricsByNeteaseResponse>();
}

/** 网易云听歌识曲（与网易云官方 Chrome 扩展同一端点），指纹由渲染端 afp.wasm 生成 */
export function matchAudioByNetease(params: NeteaseAudioMatchParams) {
  return got
    .get("https://interface.music.163.com/api/music/audio/match", {
      searchParams: {
        sessionId: "0123456789abcdef",
        algorithmCode: "shazam_v2",
        duration: params.duration,
        rawdata: params.audioFP,
        times: 1,
        decrypt: 1,
      },
      timeout: { request: 10000 },
      retry: { limit: 0 },
      headers: {
        Referer: "https://music.163.com/",
        origin: "https://music.163.com",
        "user-agent": UserAgent,
      },
    })
    .json<NeteaseAudioMatchResponse>();
}
