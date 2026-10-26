import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { config } from "./config.js";
import { AlignError, type AlignErrorCode } from "./errors.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAX_AUDIO_BYTES = 60 * 1024 * 1024;

// 与 shared/bilibili-stream.ts 的 isPcdnUrl 同一规则（服务端单独打包，不引用渲染层代码），由测试保证两边一致。
// PCDN 节点对第三方限速严重，下载会卡死；域名不可靠，只有查询参数 os=mcdn / mcdnid 能认出 *.edge.mountaintoys.cn 这类节点。
const PCDN_HOST_SUFFIXES = [".mcdn.bilivideo.cn", ".szbdyd.com"];
export const isPcdnUrl = (url: string) => {
  try {
    const { hostname, searchParams } = new URL(url);
    if (PCDN_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))) return true;
    return searchParams.get("os")?.toLowerCase() === "mcdn" || searchParams.has("mcdnid");
  } catch {
    return false;
  }
};

let lastRequestAt = 0;
let chain: Promise<unknown> = Promise.resolve();
let buvid: { value: string; expiresAt: number } | undefined;

// 所有 B 站接口请求串行、相邻至少隔 bilibiliMinIntervalMs。失败不重试：-352 / 412 是风控，惩罚窗口里加请求只会更久
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastRequestAt + config.bilibiliMinIntervalMs - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

interface BiliEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

async function getBuvid(): Promise<string> {
  if (buvid && buvid.expiresAt > Date.now()) return buvid.value;
  const res = await fetch("https://api.bilibili.com/x/frontend/finger/spi", {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as BiliEnvelope<{ b_3?: string }>;
  if (!body.data?.b_3) throw new AlignError("BILIBILI_RATE_LIMITED", `finger/spi code=${body.code}`);
  buvid = { value: body.data.b_3, expiresAt: Date.now() + 24 * 3600_000 };
  return buvid.value;
}

async function biliGet<T>(url: string): Promise<T> {
  return throttled(async () => {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Referer: "https://www.bilibili.com",
        Cookie: `buvid3=${await getBuvid()}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 412 || res.status === 429)
      throw new AlignError("BILIBILI_RATE_LIMITED", `${url} HTTP ${res.status}`);
    if (!res.ok) throw new AlignError("AUDIO_DOWNLOAD_FAILED", `${url} HTTP ${res.status}`);
    const body = (await res.json()) as BiliEnvelope<T>;
    if (body.code === -352 || body.code === -412) {
      buvid = undefined;
      throw new AlignError("BILIBILI_RATE_LIMITED", `${url} code=${body.code}`);
    }
    if (body.code === -404 || body.code === 62002 || body.code === 62004 || body.code === -403) {
      throw new AlignError("VIDEO_NOT_FOUND", `${url} code=${body.code}`);
    }
    if (body.code !== 0 || !body.data)
      throw new AlignError("AUDIO_DOWNLOAD_FAILED", `${url} code=${body.code} ${body.message ?? ""}`);
    return body.data;
  });
}

export interface VideoPage {
  bvid: string;
  cid: string;
  title: string;
  part: string;
  durationSec: number;
}

interface ViewData {
  title: string;
  pages: { cid: number; part: string; duration: number }[];
}

// cid 必须属于这个 bvid：客户端传什么就拉什么，等于让任何人借服务器带宽下载任意视频
export async function getVideoPage(bvid: string, cid: string): Promise<VideoPage> {
  const view = await biliGet<ViewData>(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  const page = view.pages.find(p => String(p.cid) === cid);
  if (!page) throw new AlignError("VIDEO_NOT_FOUND", `cid ${cid} 不属于 ${bvid}`);
  if (page.duration > config.maxDurationSec) throw new AlignError("VIDEO_TOO_LONG");
  return { bvid, cid, title: view.title, part: page.part, durationSec: page.duration };
}

interface DashStream {
  id: number;
  bandwidth: number;
  codecid?: number;
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
}

interface PlayUrlData {
  dash?: { audio?: DashStream[]; video?: DashStream[] };
}

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const streamUrls = (s: DashStream) => [
  ...new Set([s.baseUrl ?? s.base_url, ...(s.backupUrl ?? s.backup_url ?? [])].filter(Boolean) as string[]),
];

// 只取非 PCDN 的地址；全是 PCDN 时直接报错，不退而求其次（卡死比明确失败更糟，见 AGENTS.md「网络请求」）。
// 不跟随重定向：签名地址只在这里用，跳到别处就是不认识的地址
async function downloadFirstGood(
  urls: string[],
  dest: string,
  maxBytes: number,
  codes: { pcdnOnly: AlignErrorCode; failed: AlignErrorCode },
): Promise<void> {
  const good = urls.filter(u => !isPcdnUrl(u));
  if (!good.length) throw new AlignError(codes.pcdnOnly);
  let lastError: unknown;
  for (const url of good) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Referer: "https://www.bilibili.com" },
        redirect: "error",
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length > maxBytes) throw new AlignError("VIDEO_TOO_LONG", `${length} 字节`);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
      return;
    } catch (err) {
      if (err instanceof AlignError) throw err;
      lastError = err;
    }
  }
  throw new AlignError(codes.failed, `所有非 PCDN 地址都失败：${String(lastError)}`);
}

export async function downloadAudio(page: VideoPage, dest: string): Promise<void> {
  const data = await biliGet<PlayUrlData>(
    `https://api.bilibili.com/x/player/playurl?bvid=${page.bvid}&cid=${page.cid}&fnval=16&fnver=0`,
  );
  const audios = [...(data.dash?.audio ?? [])].sort((a, b) => a.bandwidth - b.bandwidth);
  if (!audios.length) throw new AlignError("AUDIO_DOWNLOAD_FAILED", "playurl 没有音频流");
  // 对齐只需要人声能听清，最低码率（约 64 kbps）足够，省部署方带宽
  await downloadFirstGood(streamUrls(audios[0]), dest, MAX_AUDIO_BYTES, {
    pcdnOnly: "AUDIO_PCDN_ONLY",
    failed: "AUDIO_DOWNLOAD_FAILED",
  });
}

// 480p 是匿名能拿到的最高档，也是识别画面字幕的实测够用档：换 1080p 对认不准的书法字体没有改善。
// 只要 AVC / HEVC：AVFoundation 直接读 DASH 分段（.m4s 当 .mp4 读，不用 ffmpeg），AV1 在不带硬解的 Mac 上读不了
const VIDEO_QN = 32;
const READABLE_CODECS = new Set([7, 12]);

export async function downloadVideo(page: VideoPage, dest: string): Promise<void> {
  const data = await biliGet<PlayUrlData>(
    `https://api.bilibili.com/x/player/playurl?bvid=${page.bvid}&cid=${page.cid}&qn=${VIDEO_QN}&fnval=16&fnver=0`,
  );
  const videos = (data.dash?.video ?? [])
    .filter(v => v.id <= VIDEO_QN && READABLE_CODECS.has(v.codecid ?? 0))
    // 清晰度高的优先；同档 AVC 优先（解码最省）
    .sort((a, b) => b.id - a.id || (a.codecid === 7 ? -1 : 1) - (b.codecid === 7 ? -1 : 1));
  if (!videos.length) throw new AlignError("VIDEO_DOWNLOAD_FAILED", "playurl 没有可读的视频流");
  await downloadFirstGood(streamUrls(videos[0]), dest, MAX_VIDEO_BYTES, {
    pcdnOnly: "VIDEO_PCDN_ONLY",
    failed: "VIDEO_DOWNLOAD_FAILED",
  });
}
