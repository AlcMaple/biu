// QQ / 酷狗 / AMLL 取词：只在持有网络能力的一侧运行（Electron 主进程、Web BFF、手机 App 的原生 HTTP），
// 浏览器页面只拿规范化结果。不用 Node 专有 API，手机 WebView 里也能跑。
// 请求形态对照 docs/lyrics/多源歌词渠道-实测报告.md 里跑通的链路；上游 SDK 不引入，免得带进它们内置的自动重试。
// 429 / 5xx / 非零业务码都原样报给调用方，这里不重试、不探测恢复。

import SparkMD5 from "spark-md5";

import {
  LyricsFormatError,
  parseKrcText,
  parseLrcText,
  parseTtmlText,
  type LyricsProvider,
  type NormalizedLyrics,
} from "./lyrics-format.js";

export const LYRICS_PROVIDERS: readonly LyricsProvider[] = ["qq", "kugou", "amll"];

export type ProviderLyricsErrorKind =
  | "rate_limited"
  | "upstream"
  | "timeout"
  | "network"
  | "business"
  | "not_found"
  | "invalid_response"
  | "unsupported_format"
  | "bad_request"
  | "unsupported_platform";

export interface ProviderLyricsError {
  kind: ProviderLyricsErrorKind;
  provider: LyricsProvider;
  status?: number;
  code?: number | string;
  message: string;
  /** 限流 / 服务异常后多久再试（毫秒）；上游给了 Retry-After 就用它，否则是本地冷却时长 */
  retryAfterMs?: number;
}

export interface ProviderLyricsCandidate {
  provider: LyricsProvider;
  /** 取词凭据：QQ songmid / 酷狗 FileHash / AMLL 文件 ID */
  id: string;
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  /** 搜索阶段就能确定的时间轴粒度；酷狗要下载后才知道 */
  timing?: "line" | "word";
  /** AMLL 社区歌词作者 */
  author?: string;
}

export interface ProviderLyricsSearchParams {
  provider: LyricsProvider;
  title: string;
  artist?: string;
}

export interface ProviderLyricsGetParams {
  provider: LyricsProvider;
  id: string;
  /** 酷狗按 Hash 查歌词候选时要毫秒时长，并带上「歌手 - 歌名」关键词（与实测跑通的请求一致） */
  durationMs?: number;
  title?: string;
  artist?: string;
}

export interface ProviderLyricsDocument {
  provider: LyricsProvider;
  /** 平台内这份歌词文件自己的 ID（酷狗是歌词 ID，不是歌曲 Hash） */
  sourceId: string;
  lyrics: NormalizedLyrics;
  author?: string;
}

export type ProviderResult<T> = { ok: true; data: T } | { ok: false; error: ProviderLyricsError };

export interface ProviderHttpRequest {
  method: "GET" | "POST";
  url: URL;
  headers: Record<string, string>;
  body?: string;
}

export interface ProviderHttpResponse {
  status: number;
  text: string;
  /** 原样的 Retry-After 响应头 */
  retryAfter?: string;
}

export class ProviderTransportError extends Error {
  constructor(readonly kind: "timeout" | "network") {
    super(kind === "timeout" ? "歌词服务响应超时" : "无法连接歌词服务");
    this.name = "ProviderTransportError";
  }
}

// 实现方必须：不自动重试、不跟随重定向、带超时；超时 / 断网抛 ProviderTransportError
export type ProviderTransport = (request: ProviderHttpRequest) => Promise<ProviderHttpResponse>;

export const PROVIDER_NAMES: Record<LyricsProvider, string> = { qq: "QQ 音乐", kugou: "酷狗", amll: "AMLL" };
const MAX_QUERY_LENGTH = 128;
const MAX_KRC_BYTES = 2 * 1024 * 1024;
const SEARCH_PAGE_SIZE = 20;

export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

class ProviderFailure extends Error {
  constructor(readonly detail: Omit<ProviderLyricsError, "provider">) {
    super(detail.message);
  }
}

function fail(kind: ProviderLyricsErrorKind, message: string, extra: Partial<ProviderLyricsError> = {}): never {
  throw new ProviderFailure({ kind, message, ...extra });
}

async function send(provider: LyricsProvider, transport: ProviderTransport, request: ProviderHttpRequest) {
  let response: ProviderHttpResponse;
  try {
    response = await transport(request);
  } catch (error) {
    if (error instanceof ProviderTransportError) fail(error.kind, error.message);
    throw error;
  }
  const name = PROVIDER_NAMES[provider];
  if (response.status === 429) {
    fail("rate_limited", `${name}请求过于频繁`, { status: 429, retryAfterMs: parseRetryAfter(response.retryAfter) });
  }
  if (response.status === 404) fail("not_found", `${name}没有这份歌词`, { status: 404 });
  if (response.status < 200 || response.status >= 300) {
    fail("upstream", `${name}服务异常（HTTP ${response.status}）`, { status: response.status });
  }
  return response.text;
}

function parseJson<T>(provider: LyricsProvider, text: string, transform?: (raw: string) => string): T {
  if (!text.trim()) fail("invalid_response", `${PROVIDER_NAMES[provider]}返回了空内容`);
  try {
    return JSON.parse(transform ? transform(text) : text) as T;
  } catch {
    fail("invalid_response", `${PROVIDER_NAMES[provider]}返回的数据无法解析`);
  }
}

function parseLyrics(parse: () => NormalizedLyrics) {
  try {
    return parse();
  } catch (error) {
    if (error instanceof LyricsFormatError) {
      fail(error.unsupported ? "unsupported_format" : "invalid_response", error.message);
    }
    throw error;
  }
}

function cleanQuery(value: string | undefined) {
  const text = value?.trim() ?? "";
  if (text.length > MAX_QUERY_LENGTH) fail("bad_request", "搜索关键词过长");
  return text;
}

function keywordOf(params: ProviderLyricsSearchParams) {
  const title = cleanQuery(params.title);
  if (!title) fail("bad_request", "请输入歌曲名称");
  return [title, cleanQuery(params.artist)].filter(Boolean).join(" ");
}

function base64Bytes(value: string) {
  return Uint8Array.from(atob(value.replace(/\s+/g, "")), char => char.charCodeAt(0));
}

function decodeBase64Utf8(value: string) {
  return new TextDecoder().decode(base64Bytes(value));
}

// ---------- QQ ----------

interface QqSearchResponse {
  code?: number;
  req_0?: {
    code?: number;
    data?: {
      body?: {
        item_song?: {
          mid?: string;
          name?: string;
          title?: string;
          interval?: number;
          singer?: { name?: string }[];
          album?: { name?: string };
        }[];
      };
    };
  };
}

interface QqLyricResponse {
  code?: number | string;
  retcode?: number | string;
  lyric?: string;
  trans?: string;
}

const QQ_HEADERS = { "User-Agent": "okhttp/3.14.9", Cookie: "tmeLoginType=-1" };

async function searchQq(transport: ProviderTransport, params: ProviderLyricsSearchParams) {
  const payload = {
    comm: {
      ct: 11,
      cv: "1003006",
      v: "1003006",
      tmeAppID: "qqmusiclight",
      nettype: "NETWORK_WIFI",
      udid: "0",
      uid: "0",
    },
    req_0: {
      module: "music.search.SearchCgiService",
      method: "DoSearchForQQMusicLite",
      param: {
        search_id: String(Date.now()) + String(Math.floor(Math.random() * 1e5)).padStart(5, "0"),
        remoteplace: "search.android.keyboard",
        query: keywordOf(params),
        search_type: 7,
        num_per_page: SEARCH_PAGE_SIZE,
        page_num: 1,
        highlight: 0,
        nqc_flag: 0,
        page_id: 1,
        grp: 1,
      },
    },
  };
  const text = await send("qq", transport, {
    method: "POST",
    url: new URL("https://u.y.qq.com/cgi-bin/musicu.fcg"),
    headers: { ...QQ_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = parseJson<QqSearchResponse>("qq", text);
  // 实测不匹配的查询也会回 2001；含义未确认，所以按检索异常报出来，不当成「没收录」
  const code = data.code !== 0 ? data.code : data.req_0?.code;
  if (code !== 0) fail("business", `QQ 音乐检索异常（业务码 ${code ?? "缺失"}）`, { code });

  return (data.req_0?.data?.body?.item_song ?? []).flatMap((song): ProviderLyricsCandidate[] => {
    if (!song.mid) return [];
    return [
      {
        provider: "qq",
        id: song.mid,
        title: song.title || song.name || "",
        artists: (song.singer ?? []).map(singer => singer.name ?? "").filter(Boolean),
        album: song.album?.name || undefined,
        durationMs: song.interval ? song.interval * 1000 : undefined,
        timing: "line",
      },
    ];
  });
}

async function getQq(transport: ProviderTransport, params: ProviderLyricsGetParams): Promise<ProviderLyricsDocument> {
  if (!/^[0-9A-Za-z]{8,20}$/.test(params.id)) fail("bad_request", "QQ 音乐歌曲 ID 不合法");
  const url = new URL("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg");
  url.searchParams.set("songmid", params.id);
  url.searchParams.set("format", "json");
  url.searchParams.set("outCharset", "utf-8");
  url.searchParams.set("pcachetime", String(Date.now()));
  const text = await send("qq", transport, { method: "GET", url, headers: { Referer: "https://y.qq.com/" } });
  const data = parseJson<QqLyricResponse>("qq", text);
  if (Number(data.code) !== 0 || Number(data.retcode) !== 0) {
    fail("business", `QQ 音乐取词异常（业务码 ${data.code ?? data.retcode ?? "缺失"}）`, { code: data.code });
  }
  if (!data.lyric) fail("not_found", "QQ 音乐没有这首歌的歌词");
  const lyric = decodeBase64Utf8(data.lyric);
  const trans = data.trans ? decodeBase64Utf8(data.trans) : undefined;
  return { provider: "qq", sourceId: params.id, lyrics: parseLyrics(() => parseLrcText(lyric, trans)) };
}

// ---------- 酷狗 ----------

// 签名盐、请求头与 appid 取自固定版本 MIT 上游 KuGouMusicApi v1.6.0 的 util/helper.js
const KUGOU_SALT = "OIlwieks28dk2k092lksi2UIkp";
const KUGOU_APP = { appid: 1005, clientver: 20489 };
// 每个进程一个匿名设备号，不注册、不读账号
const KUGOU_MID = BigInt(`0x${SparkMD5.hash(`${Date.now()}-${Math.random()}`)}`).toString();
const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];

function kugouSigned(params: Record<string, string | number>) {
  const joined = Object.keys(params)
    .toSorted()
    .map(key => `${key}=${params[key]}`)
    .join("");
  const signature = SparkMD5.hash(`${KUGOU_SALT}${joined}${KUGOU_SALT}`);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  query.set("signature", signature);
  return query;
}

function kugouHeaders(clienttime?: number): Record<string, string> {
  return {
    "User-Agent": "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi",
    dfid: "-",
    mid: KUGOU_MID,
    "kg-rc": "1",
    "kg-thash": "5d816a0",
    "kg-rec": "1",
    "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
    ...(clienttime === undefined ? {} : { clienttime: String(clienttime) }),
  };
}

interface KugouCatalogResponse {
  status?: number;
  error_code?: number;
  data?: {
    lists?: {
      FileHash?: string;
      OriSongName?: string;
      SongName?: string;
      SingerName?: string;
      AlbumName?: string;
      Duration?: number;
    }[];
  };
}

interface KugouLyricSearchResponse {
  status?: number;
  errcode?: number;
  candidates?: { id?: string | number; accesskey?: string; nickname?: string; product_from?: string }[];
}

interface KugouDownloadResponse {
  status?: number;
  error_code?: number;
  content?: string;
  id?: string;
}

async function searchKugou(transport: ProviderTransport, params: ProviderLyricsSearchParams) {
  const clienttime = Math.floor(Date.now() / 1000);
  const query = kugouSigned({
    dfid: "-",
    mid: KUGOU_MID,
    uuid: "-",
    ...KUGOU_APP,
    clienttime,
    albumhide: 0,
    iscorrection: 1,
    keyword: keywordOf(params),
    nocollect: 0,
    page: 1,
    pagesize: SEARCH_PAGE_SIZE,
    platform: "AndroidFilter",
  });
  const text = await send("kugou", transport, {
    method: "GET",
    url: new URL(`https://gateway.kugou.com/v3/search/song?${query}`),
    headers: { ...kugouHeaders(clienttime), "x-router": "complexsearch.kugou.com" },
  });
  const data = parseJson<KugouCatalogResponse>("kugou", text);
  if (data.status !== 1 || (data.error_code ?? 0) !== 0) {
    fail("business", `酷狗检索异常（业务码 ${data.error_code ?? data.status ?? "缺失"}）`, { code: data.error_code });
  }
  return (data.data?.lists ?? []).flatMap((song): ProviderLyricsCandidate[] => {
    if (!song.FileHash || !/^[0-9A-Fa-f]{32}$/.test(song.FileHash)) return [];
    return [
      {
        provider: "kugou",
        id: song.FileHash.toUpperCase(),
        title: song.OriSongName || song.SongName || "",
        artists: song.SingerName ? song.SingerName.split(/[、,]/).map(name => name.trim()) : [],
        album: song.AlbumName || undefined,
        // 曲库给的是秒，歌词候选查询要毫秒
        durationMs: song.Duration ? song.Duration * 1000 : undefined,
      },
    ];
  });
}

// DecompressionStream 在 Node 18+、Electron、Android WebView 与 iOS 16.4+ 都有，解压时边读边数字节，超过上限就停
async function inflateLimited(payload: Uint8Array<ArrayBuffer>, limit: number) {
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new LyricsFormatError("酷狗歌词解压后过大");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function decodeKrc(encoded: string): Promise<string> {
  let raw: Uint8Array;
  try {
    raw = base64Bytes(encoded);
  } catch {
    throw new LyricsFormatError("酷狗歌词不是有效的 base64");
  }
  if (String.fromCharCode(...raw.subarray(0, 4)) !== "krc1") throw new LyricsFormatError("酷狗歌词文件头不对");
  const payload = raw.subarray(4).map((byte, index) => byte ^ KRC_KEY[index % KRC_KEY.length]);
  let clear: Uint8Array;
  try {
    clear = await inflateLimited(payload, MAX_KRC_BYTES);
  } catch (error) {
    if (error instanceof LyricsFormatError) throw error;
    throw new LyricsFormatError("酷狗歌词解压失败");
  }
  return new TextDecoder().decode(clear).replace(/^\uFEFF/, "");
}

async function getKugou(
  transport: ProviderTransport,
  params: ProviderLyricsGetParams,
): Promise<ProviderLyricsDocument> {
  if (!/^[0-9A-F]{32}$/.test(params.id)) fail("bad_request", "酷狗歌曲 Hash 不合法");
  if (!params.durationMs || !Number.isSafeInteger(params.durationMs) || params.durationMs <= 0) {
    fail("bad_request", "酷狗取词缺少歌曲时长");
  }
  const searchQuery = kugouSigned({
    album_audio_id: 0,
    ...KUGOU_APP,
    duration: params.durationMs,
    hash: params.id,
    keyword: [cleanQuery(params.artist), cleanQuery(params.title)].filter(Boolean).join(" - "),
    lrctxt: 1,
    man: "no",
  });
  const searchText = await send("kugou", transport, {
    method: "GET",
    url: new URL(`https://lyrics.kugou.com/v1/search?${searchQuery}`),
    headers: kugouHeaders(),
  });
  const found = parseJson<KugouLyricSearchResponse>("kugou", searchText);
  if (found.status !== 200)
    fail("business", `酷狗歌词检索异常（业务码 ${found.status ?? "缺失"}）`, { code: found.status });
  const candidate = found.candidates?.find(item => item.id && item.accesskey);
  if (!candidate) fail("not_found", "酷狗没有这首歌的歌词");

  const clienttime = Math.floor(Date.now() / 1000);
  const downloadQuery = kugouSigned({
    dfid: "-",
    mid: KUGOU_MID,
    uuid: "-",
    ...KUGOU_APP,
    clienttime,
    ver: 1,
    client: "android",
    id: String(candidate.id),
    accesskey: candidate.accesskey!,
    fmt: "krc",
    charset: "utf8",
  });
  const downloadText = await send("kugou", transport, {
    method: "GET",
    url: new URL(`https://lyrics.kugou.com/download?${downloadQuery}`),
    headers: kugouHeaders(clienttime),
  });
  const download = parseJson<KugouDownloadResponse>("kugou", downloadText);
  if (download.status !== 200 || !download.content) {
    fail("business", `酷狗歌词下载异常（业务码 ${download.error_code ?? download.status ?? "缺失"}）`, {
      code: download.error_code,
    });
  }
  let krc: string;
  try {
    krc = await decodeKrc(download.content!);
  } catch (error) {
    if (error instanceof LyricsFormatError) fail("invalid_response", error.message);
    throw error;
  }
  const lyrics = parseLyrics(() => parseKrcText(krc));
  return { provider: "kugou", sourceId: String(candidate.id), lyrics, author: candidate.nickname || undefined };
}

// ---------- AMLL ----------

interface AmllItem {
  id?: string;
  musicNames?: string[];
  artistNames?: string[];
  albumNames?: string[];
  authorUsernames?: string[];
}

interface AmllSearchResponse {
  status?: number;
  data?: { items?: AmllItem[] };
}

interface AmllGetResponse {
  status?: number;
  data?: AmllItem & { lyrics?: string; format?: string };
}

const AMLL_ORIGIN = "https://api.amll.dev";
// 文件 ID 已经贴着 2^53 了，按数字解析会丢精度，先把 id 字段改成字符串再 JSON.parse
const quoteAmllIds = (raw: string) => raw.replace(/"id"\s*:\s*(\d+)/g, '"id":"$1"');

async function searchAmll(transport: ProviderTransport, params: ProviderLyricsSearchParams) {
  const title = cleanQuery(params.title);
  if (!title) fail("bad_request", "请输入歌曲名称");
  const url = new URL("/v1/lyrics/search", AMLL_ORIGIN);
  url.searchParams.set("musicName", title);
  const artist = cleanQuery(params.artist);
  if (artist) url.searchParams.set("artistName", artist);
  url.searchParams.set("pageSize", String(SEARCH_PAGE_SIZE));
  const text = await send("amll", transport, { method: "GET", url, headers: { Accept: "application/json" } });
  const data = parseJson<AmllSearchResponse>("amll", text, quoteAmllIds);
  if (data.status !== 200) fail("business", `AMLL 检索异常（状态 ${data.status ?? "缺失"}）`, { code: data.status });

  return (data.data?.items ?? []).flatMap((item): ProviderLyricsCandidate[] => {
    if (!item.id) return [];
    return [
      {
        provider: "amll",
        id: item.id,
        title: item.musicNames?.[0] ?? "",
        artists: item.artistNames ?? [],
        album: item.albumNames?.[0],
        timing: "word",
        author: item.authorUsernames?.[0],
      },
    ];
  });
}

async function getAmll(transport: ProviderTransport, params: ProviderLyricsGetParams): Promise<ProviderLyricsDocument> {
  if (!/^\d{1,20}$/.test(params.id)) fail("bad_request", "AMLL 歌词 ID 不合法");
  const url = new URL("/v1/lyrics/get", AMLL_ORIGIN);
  url.searchParams.set("id", params.id);
  const text = await send("amll", transport, { method: "GET", url, headers: { Accept: "application/json" } });
  const data = parseJson<AmllGetResponse>("amll", text, quoteAmllIds);
  if (data.status !== 200 || !data.data?.lyrics) {
    fail("business", `AMLL 取词异常（状态 ${data.status ?? "缺失"}）`, { code: data.status });
  }
  if (data.data.format && data.data.format !== "ttml")
    fail("unsupported_format", `AMLL 歌词格式 ${data.data.format} 不支持`);
  const ttml = data.data.lyrics;
  const author = Array.isArray(data.data.authorUsernames) ? data.data.authorUsernames[0] : undefined;
  return { provider: "amll", sourceId: params.id, lyrics: parseLyrics(() => parseTtmlText(ttml)), author };
}

// ---------- 入口 ----------

function isProvider(value: unknown): value is LyricsProvider {
  return LYRICS_PROVIDERS.includes(value as LyricsProvider);
}

async function run<T>(provider: unknown, task: (provider: LyricsProvider) => Promise<T>): Promise<ProviderResult<T>> {
  if (!isProvider(provider)) {
    return { ok: false, error: { kind: "bad_request", provider: "qq", message: "不支持的歌词来源" } };
  }
  try {
    return { ok: true, data: await task(provider) };
  } catch (error) {
    if (error instanceof ProviderFailure) return { ok: false, error: { provider, ...error.detail } };
    throw error;
  }
}

export function searchProviderLyrics(transport: ProviderTransport, params: ProviderLyricsSearchParams) {
  return run<ProviderLyricsCandidate[]>(params.provider, provider => {
    if (provider === "qq") return searchQq(transport, params);
    if (provider === "kugou") return searchKugou(transport, params);
    return searchAmll(transport, params);
  });
}

export function getProviderLyrics(transport: ProviderTransport, params: ProviderLyricsGetParams) {
  return run<ProviderLyricsDocument>(params.provider, provider => {
    if (typeof params.id !== "string") fail("bad_request", "歌词 ID 不合法");
    if (provider === "qq") return getQq(transport, params);
    if (provider === "kugou") return getKugou(transport, params);
    return getAmll(transport, params);
  });
}
