interface SearchSongByNeteaseParams {
  s: string;
  type: number;
  limit: number;
  offset: number;
}

interface SearchSongByNeteaseResponse {
  result?: {
    songs?: NeteaseSong[];
    hasMore?: boolean;
    songCount?: number;
  };
  code?: number;
  trp?: {
    rules?: string[];
  };
}

interface NeteaseSong {
  id?: number;
  name?: string;
  alias?: string[];
  artists?: NeteaseArtist[];
  album?: NeteaseAlbum;
  duration?: number;
  fee?: number;
  rtype?: number;
  ftype?: number;
  copyrightId?: number;
  transNames?: string[];
  mvid?: number;
  mark?: number;
  status?: number;
}

interface NeteaseAlbum {
  id?: number;
  name?: string;
  publishTime?: number;
  size?: number;
  picId?: number;
  artist?: NeteaseArtist;
  copyrightId?: number;
  alia?: string[];
  mark?: number;
  status?: number;
  transNames?: string[];
}

interface NeteaseArtist {
  id?: number;
  name?: string;
  alias?: string[];
  img1v1Url?: string;
  picId?: number;
  musicSize?: number;
  albumSize?: number;
  img1v1?: number;
}

interface GetLyricsByNeteaseParams {
  id: number;
}

interface GetLyricsByNeteaseResponse {
  sgc?: boolean;
  sfy?: boolean;
  qfy?: boolean;
  transUser?: NeteaseUser;
  lyricUser?: NeteaseUser;
  /** 歌词原文 */
  lrc?: NeteaseKlyric;
  klyric?: NeteaseKlyric;
  /** 翻译歌词 */
  tlyric?: NeteaseKlyric;
  /** 歌词发音，一些日语等歌曲会有 */
  romalrc?: NeteaseKlyric;
  code?: number;
}

interface NeteaseKlyric {
  version?: number;
  lyric?: string;
}

interface NeteaseUser {
  id?: number;
  status?: number;
  demand?: number;
  userid?: number;
  nickname?: string;
  uptime?: number;
}

interface GetSimiSongByNeteaseParams {
  songid: number;
  limit?: number;
}

interface GetSimiSongByNeteaseResponse {
  code?: number;
  songs?: NeteaseSong[];
}

interface SearchSongByLrclibParams {
  q: string;
  track_name?: string;
  artist_name?: string;
  album_name?: string;
}

interface SearchSongByLrclibResponse {
  id?: number;
  name?: string;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  /** 歌词文本 */
  plainLyrics?: null | string;
  /** 歌词时间同步文本 */
  syncedLyrics?: null | string;
}

interface LyricsPreference {
  fontSize: number;
  offsetMs: number;
  showTranslation: boolean;
}

interface LyricLine {
  time: number;
  text: string;
}

interface MusicLyrics {
  fontSize?: number;
  offset?: number;
  lyrics?: string;
  tLyrics?: string;
  /**
   * 歌词来源：manual=用户手动采用（永不被自动结果覆盖）；缺省视为 manual（兼容旧缓存）；
   * aligned=用户采用的自动对齐结果（同样不被覆盖）；approved=审核通过、对所有人生效的版本（有新版本时自动更新）
   */
  source?: "manual" | "auto" | "aligned" | "approved";
  /** source=auto 时记录生成它的匹配算法版本，算法升级后会自动重新匹配 */
  autoVersion?: number;
  /** 逐字时间轴（source 为 aligned / approved 时有）；lyrics 里同时存一份行级 LRC，给只认行时间的地方用 */
  alignment?: Pick<LyricsAlignment, "lyricsHash" | "lines">;
  /** 第一次采用对齐结果前的歌词，用于「还原」 */
  preAlign?: Pick<MusicLyrics, "lyrics" | "tLyrics" | "source" | "autoVersion">;
}

interface NeteaseAudioMatchParams {
  /** 指纹对应的音频时长（秒） */
  duration: number;
  /** afp.wasm 生成的 base64 指纹 */
  audioFP: string;
}

interface NeteaseAudioMatchSong {
  id: number;
  name: string;
  duration?: number;
  alias?: string[];
  transNames?: string[];
  artists?: { id?: number; name?: string }[];
  album?: { id?: number; name?: string; picUrl?: string };
}

interface NeteaseAudioMatchResponse {
  code?: number;
  data?: {
    type?: number;
    queryId?: string;
    result?: { startTime?: number; song?: NeteaseAudioMatchSong }[] | null;
  };
}
