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
   * aligned=用户自己选的歌词的逐字对齐结果（同样不被覆盖）；approved=对所有人生效的版本（自动对齐 / 审核通过的上传 / 管理员发布，有新版本时自动更新）
   */
  source?: "manual" | "auto" | "aligned" | "approved";
  /** source=auto 时记录生成它的匹配算法版本，算法升级后会自动重新匹配 */
  autoVersion?: number;
  /** 逐字时间轴（source 为 aligned / approved 时有）；lyrics 里同时存一份行级 LRC，给只认行时间的地方用 */
  alignment?: Pick<LyricsAlignment, "lyricsHash" | "lines">;
  /** 第一次采用对齐结果前的歌词，用于「还原」 */
  preAlign?: Pick<MusicLyrics, "lyrics" | "tLyrics" | "source" | "autoVersion" | "offset">;
  /** 用户点过「还原为对齐前的歌词」：不再自动对齐这份，直到换一份歌词 */
  noAutoAlign?: true;
  /** 歌词从哪个平台采用来的；与 source（采用方式）、alignment（按当前录音对齐）各管各的 */
  origin?: LyricsOrigin;
  /** 歌词识别自视频画面 / 来自 B 站 AI 字幕（填词歌）；text 是当时的歌词文字，换了歌词就不再算数 */
  screenOrigin?: ScreenOrigin;
  /** 平台自带的逐字时间轴（原唱录音），不等于对齐到当前 B 站录音；lyrics 与采用时不一致就作废 */
  nativeTiming?: NativeLyricsTiming;
}

interface ScreenOrigin {
  /** screen = 画面歌词且和字幕读音吻合；screen-unsure = 画面歌词但吻合度低（书法字体等）；subtitle = AI 字幕原文 */
  kind: "screen" | "screen-unsure" | "subtitle";
  text: string;
}

interface LyricsOrigin {
  provider: import("../lyrics-format").LyricsProvider;
  /** 平台内的歌词 / 歌曲 ID，用于溯源，不用来取词 */
  sourceId: string;
  title: string;
  artists: string[];
  author?: string;
  format: import("../lyrics-format").LyricsSourceFormat;
  timing: "line" | "word";
  adoptedAt: number;
}

interface NativeLyricsTiming {
  /** 采用时写进 lyrics 的行级 LRC，读的时候对不上说明歌词已被换掉 */
  lyrics: string;
  lines: { startMs: number; endMs: number; words: { startMs: number; endMs: number; text: string }[] }[];
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
