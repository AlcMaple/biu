import got from "got";

import { UserAgent } from "../../network/user-agent";

/**
 * 网易云「相似歌曲」。走未签名的开放端点（与歌词搜索同一个 host / 同一套请求头），
 * 无需登录/cookie/加密。给定一个歌曲 id，返回一串同曲风的相似歌（含跨歌手）。
 */
export function getSimiSongByNetease(params: GetSimiSongByNeteaseParams) {
  return got
    .get("https://music.163.com/api/v1/discovery/simiSong", {
      searchParams: {
        songid: params.songid,
        limit: params.limit ?? 10,
        offset: 0,
      },
      timeout: { request: 10000 },
      retry: { limit: 2 },
      headers: {
        Referer: "https://music.163.com/",
        origin: "https://music.163.com",
        "user-agent": UserAgent,
      },
    })
    .json<GetSimiSongByNeteaseResponse>();
}
