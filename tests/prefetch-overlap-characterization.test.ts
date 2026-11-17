import type { AddressInfo } from "node:net";

import axios from "axios";
import { createHash } from "node:crypto";
import { once } from "node:events";
import http, { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PlayMode } from "@/common/constants/audio";
import { DEMO_VIDEOS } from "@/common/offline-demo-fixtures";
import { isUrlValid } from "@/common/utils/audio";
import * as requests from "@/service/request";
import { clearWbiKeyCache } from "@/service/request/wbi-key-cache";
import { usePlayList, type PlayItem } from "@/store/play-list";
import { BILIBILI_UPSTREAMS, getBilibiliMediaProxyExpiry, isBilibiliMediaProxyUrl } from "@shared/bilibili-web-proxy";

import { createSandboxBilibiliServer } from "../scripts/sandbox-bilibili/server";
import { createBilibiliProxyHandler } from "../web-server/proxy";

type Track = "A" | "B" | "C";
type Phase = "initial" | "prefetch" | "select-B" | "select-C" | "release" | "repeat-timeupdate";
interface Arrival {
  id: number;
  track?: Track;
  path: string;
  phase: Phase;
  arrivedMs: number;
  held: boolean;
  released?: "success" | "http-500";
  status?: number;
  finished: boolean;
  earlyClose: boolean;
  aborted: boolean;
}

const videos = DEMO_VIDEOS.slice(0, 3);
const tracks: Track[] = ["A", "B", "C"];
const playlist: PlayItem[] = videos.map(video => ({
  type: "mv",
  bvid: video.bvid,
  cid: String(video.aid + 10),
  title: video.title,
  cover: video.pic,
  ownerName: video.author,
  ownerMid: video.mid,
  duration: 60,
}));
const clients = [
  [requests.apiRequest, "api"],
  [requests.biliRequest, "www"],
  [requests.memberRequest, "member"],
  [requests.passportRequest, "passport"],
  [requests.searchRequest, "search"],
] as const;
const defaults = clients.map(([client]) => ({
  client,
  baseURL: client.defaults.baseURL,
  adapter: client.defaults.adapter,
  timeout: client.defaults.timeout,
}));
let fixture: Awaited<ReturnType<typeof createFixture>> | undefined;
let restoreFetch: (() => boolean) | undefined;
let logKinds: string[] = [];
let blockedNetwork: string[] = [];

function loopbackOnly(original: typeof http.request) {
  return new Proxy(original, {
    apply(target, receiver, args) {
      const input: unknown = args[0];
      const hostname =
        input instanceof URL
          ? input.hostname
          : typeof input === "string"
            ? new URL(input).hostname
            : typeof input === "object" && input !== null
              ? new URL(
                  `http://${String((input as { hostname?: string; host?: string }).hostname ?? (input as { host?: string }).host ?? "localhost")}`,
                ).hostname
              : "unknown";
      if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname)) {
        blockedNetwork.push("non-loopback-http-request");
        throw new Error("Non-loopback HTTP request rejected by experiment boundary");
      }
      return Reflect.apply(target, receiver, args);
    },
  });
}

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server) {
  if (!server.listening) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
}

async function until(condition: () => boolean, label: string, limitMs = 1500) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > limitMs) throw new Error(`Local fixture condition timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function createFixture() {
  const started = Date.now();
  const arrivals: Arrival[] = [];
  const held = new Map<number, { request: IncomingMessage; response: ServerResponse; entry: Arrival }>();
  const upstream = createSandboxBilibiliServer();
  const handlers = upstream.listeners("request") as Array<(request: IncomingMessage, response: ServerResponse) => void>;
  upstream.removeAllListeners("request");
  let phase: Phase = "initial";
  let holdB = true;
  let peakHeld = 0;
  upstream.on("request", (request, response) => {
    const target = new URL(request.url ?? "/", "http://fixture.local");
    const bvid = target.searchParams.get("bvid");
    const index = videos.findIndex(video => video.bvid === bvid);
    const entry: Arrival = {
      id: arrivals.length + 1,
      track: tracks[index],
      path: target.pathname,
      phase,
      arrivedMs: Date.now() - started,
      held: holdB && index === 1 && target.pathname.endsWith("/x/player/wbi/playurl"),
      finished: false,
      earlyClose: false,
      aborted: false,
    };
    arrivals.push(entry);
    request.once("aborted", () => {
      entry.aborted = true;
    });
    response.once("finish", () => {
      entry.finished = true;
      entry.status = response.statusCode;
      held.delete(entry.id);
    });
    response.once("close", () => {
      entry.earlyClose = !response.writableEnded;
      held.delete(entry.id);
    });
    if (arrivals.length > 32) {
      response.writeHead(503).end();
      return;
    }
    if (entry.held) {
      held.set(entry.id, { request, response, entry });
      peakHeld = Math.max(peakHeld, held.size);
    } else for (const handler of handlers) handler(request, response);
  });
  const upstreamOrigin = await listen(upstream);
  const handler = createBilibiliProxyHandler({
    logger: { error: () => logKinds.push("bff-error"), warn: () => logKinds.push("bff-warning") },
    mapUpstreamForTest(target) {
      return new URL(`/__host/${target.hostname}${target.pathname}${target.search}`, upstreamOrigin);
    },
  });
  const bff = createServer((request, response) => {
    void handler(request, response).then(handled => {
      if (!handled && !response.writableEnded) response.writeHead(404).end();
    });
  });
  const bffOrigin = await listen(bff);
  const release = (kind: "success" | "http-500" = "success") => {
    holdB = false;
    phase = "release";
    const ids: number[] = [];
    for (const { request, response, entry } of [...held.values()]) {
      if (response.destroyed || response.writableEnded) continue;
      ids.push(entry.id);
      entry.released = kind;
      held.delete(entry.id);
      if (kind === "http-500") response.writeHead(500, { "Content-Type": "application/json" }).end('{"code":-500}');
      else for (const original of handlers) original(request, response);
    }
    return ids;
  };
  return {
    arrivals,
    bffOrigin,
    get peakHeld() {
      return peakHeld;
    },
    phase(next: Phase) {
      phase = next;
    },
    release,
    bRequests: () => arrivals.filter(entry => entry.track === "B" && entry.path.endsWith("/x/player/wbi/playurl")),
    async settle() {
      await until(
        () => arrivals.every(entry => entry.finished || entry.earlyClose),
        "all observed upstream requests settled",
      );
    },
    async close() {
      release();
      await close(bff);
      await close(upstream);
      return !bff.listening && !upstream.listening;
    },
  };
}

function describeUrl(value: string | undefined) {
  if (!value) return null;
  const expiry = getBilibiliMediaProxyExpiry(value);
  return {
    kind: isBilibiliMediaProxyUrl(value) ? "same-origin-media-token" : "unexpected",
    validByRealResolver: isUrlValid(value),
    expiryRemainingMs: expiry === undefined ? null : expiry * 1000 - Date.now(),
    sha256: createHash("sha256").update(value).digest("hex"),
  };
}

function snapshot() {
  const state = usePlayList.getState();
  const audio = state.getAudio();
  return {
    currentPlayId: state.playId,
    currentTrack: tracks[videos.findIndex(video => video.bvid === state.getPlayItem()?.bvid)],
    audioUrl: describeUrl(audio.src),
    audioMatchesCurrentQueueUrl: audio.src === state.getPlayItem()?.audioUrl,
    isPlaying: state.isPlaying,
    audioPaused: audio.paused,
    queue: state.list.map(item => ({
      id: item.id,
      track: tracks[videos.findIndex(video => video.bvid === item.bvid)],
      contentKey: { bvid: item.bvid, cid: item.cid },
      audioUrl: describeUrl(item.audioUrl),
    })),
  };
}

function emitResult(name: string, phases: unknown[]) {
  console.info(
    "PREFETCH_CHARACTERIZATION",
    JSON.stringify({
      name,
      scope: "real store + Axios HTTP + BFF + loopback upstream; synthetic Audio event, not browser sound",
      observationWindowMs: 100,
      phases,
      requests: fixture!.arrivals,
      bPlayurlArrivals: fixture!.bRequests().length,
      completed: fixture!.bRequests().filter(entry => entry.finished).length,
      earlyClose: fixture!.bRequests().filter(entry => entry.earlyClose).length,
      peakHeld: fixture!.peakHeld,
      final: snapshot(),
      logKinds,
      blockedNetwork,
    }),
  );
}

function select(track: Track) {
  const id = usePlayList.getState().list.find(item => item.bvid === videos[tracks.indexOf(track)].bvid)?.id;
  if (!id) throw new Error(`Missing synthetic ${track}`);
  return usePlayList.getState().playListItem(id);
}

async function waitPlaying(track: Track) {
  await until(() => {
    const state = usePlayList.getState();
    return (
      state.getPlayItem()?.bvid === videos[tracks.indexOf(track)].bvid &&
      Boolean(state.getPlayItem()?.audioUrl) &&
      state.isPlaying
    );
  }, `${track} selected and source resolved`);
}

async function prefetchB() {
  const audio = usePlayList.getState().getAudio();
  fixture!.phase("prefetch");
  Object.defineProperty(audio, "duration", { configurable: true, writable: true, value: 60 });
  audio.currentTime = 40;
  audio.ontimeupdate?.(new Event("timeupdate"));
  await until(() => fixture!.bRequests().some(entry => entry.held), "B prefetch arrived at real upstream");
}

beforeEach(async () => {
  expect(process.env.BIU_PREFETCH_OBSERVER_MODULE).toBeUndefined();
  logKinds = [];
  blockedNetwork = [];
  restoreFetch = undefined;
  vi.spyOn(console, "error").mockImplementation(() => logKinds.push("console-error-details-omitted"));
  vi.spyOn(console, "warn").mockImplementation(() => logKinds.push("console-warning-details-omitted"));
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  vi.spyOn(http, "request").mockImplementation(loopbackOnly(originalHttpRequest));
  vi.spyOn(https, "request").mockImplementation(loopbackOnly(originalHttpsRequest));
  syncBuiltinESMExports();
  await usePlayList.persist.rehydrate();
  usePlayList.getState().clear();
  clearWbiKeyCache();
  expect(usePlayList.getState().playMode).toBe(PlayMode.Loop);
  fixture = await createFixture();
  const adapter = axios.getAdapter("http");
  for (const [client, upstream] of clients) {
    client.defaults.baseURL = fixture.bffOrigin + BILIBILI_UPSTREAMS[upstream].proxyPrefix;
    client.defaults.adapter = adapter;
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, fixture!.bffOrigin);
    if (url.hostname !== "127.0.0.1") {
      blockedNetwork.push("non-loopback-fetch");
      throw new Error("Non-loopback fetch rejected by experiment boundary");
    }
    return originalFetch(url, init);
  };
  restoreFetch = () => {
    globalThis.fetch = originalFetch;
    return globalThis.fetch === originalFetch;
  };
  await usePlayList.getState().init();
  await usePlayList.getState().playList(playlist);
  await waitPlaying("A");
});

afterEach(async () => {
  let fixtureServersClosed = !fixture;
  let fetchRestored = false;
  try {
    fixture?.release();
    if (fixture) await fixture.settle();
  } finally {
    try {
      usePlayList.getState().getAudio().pause();
      usePlayList.getState().clear();
      if (fixture) fixtureServersClosed = await fixture.close();
    } finally {
      fixture = undefined;
      fetchRestored = restoreFetch?.() ?? true;
      for (const { client, baseURL, adapter } of defaults) {
        client.defaults.baseURL = baseURL;
        client.defaults.adapter = adapter;
      }
      vi.restoreAllMocks();
      syncBuiltinESMExports();
    }
  }
  const axiosDefaultsRestored = defaults.every(
    ({ client, baseURL, adapter, timeout }) =>
      client.defaults.baseURL === baseURL && client.defaults.adapter === adapter && client.defaults.timeout === timeout,
  );
  expect(blockedNetwork).toEqual([]);
  expect({ fixtureServersClosed, axiosDefaultsRestored, fetchRestored }).toEqual({
    fixtureServersClosed: true,
    axiosDefaultsRestored: true,
    fetchRestored: true,
  });
  console.info("PREFETCH_CLEANUP", JSON.stringify({ fixtureServersClosed, axiosDefaultsRestored, fetchRestored }));
});

describe("预取与公开选曲动作的真实HTTP刻画", () => {
  test("B预取在途时选B，释放实际到达请求后完成选曲", async () => {
    await prefetchB();
    const phases: unknown[] = [{ phase: "prefetch-held", bArrivals: fixture!.bRequests().length }];
    fixture!.phase("select-B");
    await select("B");
    await new Promise(resolve => setTimeout(resolve, 100));
    phases.push({ phase: "selected-observation-deadline", bArrivals: fixture!.bRequests().length });
    phases.push({ phase: "release", ids: fixture!.release() });
    await waitPlaying("B");
    await fixture!.settle();
    expect(snapshot()).toMatchObject({ currentTrack: "B", isPlaying: true, audioPaused: false });
    expect(fixture!.bRequests()).toHaveLength(2);
    expect(fixture!.bRequests().every(entry => entry.finished && !entry.earlyClose)).toBe(true);
    emitResult("overlap", phases);
  });

  test("B预取已完成且A仍在播放时选B只复用已有地址", async () => {
    await prefetchB();
    fixture!.release();
    await until(() => Boolean(usePlayList.getState().list[1].audioUrl), "prefetched B source written to queue");
    expect(isUrlValid(usePlayList.getState().list[1].audioUrl)).toBe(true);
    const phases: unknown[] = [
      { phase: "prefetch-complete", bArrivals: fixture!.bRequests().length, prefetchedItem: snapshot().queue[1] },
    ];
    const prefetchedUrl = usePlayList.getState().list[1].audioUrl;
    expect(usePlayList.getState().getAudio().paused).toBe(false);
    fixture!.phase("select-B");
    await select("B");
    await waitPlaying("B");
    await fixture!.settle();
    phases.push({ phase: "selected-complete", bArrivals: fixture!.bRequests().length });
    expect(snapshot()).toMatchObject({ currentTrack: "B", isPlaying: true, audioPaused: false });
    expect(fixture!.bRequests()).toHaveLength(1);
    expect(usePlayList.getState().getAudio().src).toBe(prefetchedUrl);
    emitResult("completed-before-select", phases);
  });

  test("B预取完成且先暂停A后再选B，单列暂停状态对照", async () => {
    await prefetchB();
    fixture!.release();
    await until(() => Boolean(usePlayList.getState().list[1].audioUrl), "prefetched B source written to queue");
    expect(isUrlValid(usePlayList.getState().list[1].audioUrl)).toBe(true);
    const phases: unknown[] = [
      { phase: "prefetch-complete", bArrivals: fixture!.bRequests().length, prefetchedItem: snapshot().queue[1] },
    ];
    usePlayList.getState().togglePlay();
    expect(usePlayList.getState().getAudio().paused).toBe(true);
    fixture!.phase("select-B");
    await select("B");
    await waitPlaying("B");
    await fixture!.settle();
    phases.push({ phase: "selected-from-paused", bArrivals: fixture!.bRequests().length });
    expect(snapshot()).toMatchObject({ currentTrack: "B", isPlaying: true, audioPaused: false });
    expect(fixture!.bRequests()).toHaveLength(1);
    emitResult("completed-before-select-paused", phases);
  });

  test("目标项缓存的过期提示要求重新取址，不复用旧token", async () => {
    await prefetchB();
    fixture!.release();
    await until(() => Boolean(usePlayList.getState().list[1].audioUrl), "prefetched B source written to queue");
    const before = usePlayList.getState().list;
    const oldA = before[0].audioUrl;
    const oldB = before[1].audioUrl;
    if (!oldA || !oldB) throw new Error("Synthetic queue sources were not ready");
    const expiredB = `${oldB.split("?e=", 1)[0]}?e=${Math.floor(Date.now() / 1000) - 1}`;
    expect(isUrlValid(expiredB)).toBe(false);
    await usePlayList
      .getState()
      .playList(
        playlist.map((item, index) => ({ ...item, audioUrl: index === 0 ? oldA : index === 1 ? expiredB : undefined })),
      );
    await waitPlaying("A");
    const phases: unknown[] = [
      {
        phase: "expired-hint-seeded-by-public-playList",
        bArrivals: fixture!.bRequests().length,
        target: snapshot().queue[1],
      },
    ];
    fixture!.phase("select-B");
    await select("B");
    await waitPlaying("B");
    await fixture!.settle();
    expect(fixture!.bRequests()).toHaveLength(2);
    expect(usePlayList.getState().getAudio().src).not.toBe(expiredB);
    expect(isUrlValid(usePlayList.getState().getPlayItem()?.audioUrl)).toBe(true);
    expect(snapshot()).toMatchObject({ currentTrack: "B", isPlaying: true, audioPaused: false });
    emitResult("expired-target-cache", phases);
  });

  test("只有旧A有地址时选B仍为B取址，不误用当前音频地址", async () => {
    fixture!.release();
    const oldSource = usePlayList.getState().getAudio().src;
    expect(isUrlValid(oldSource)).toBe(true);
    expect(usePlayList.getState().list[1].audioUrl).toBeUndefined();
    fixture!.phase("select-B");
    await select("B");
    await waitPlaying("B");
    await fixture!.settle();
    expect(fixture!.bRequests()).toHaveLength(1);
    expect(usePlayList.getState().getAudio().src).not.toBe(oldSource);
    expect(snapshot()).toMatchObject({ currentTrack: "B", isPlaying: true, audioPaused: false });
    emitResult("uncached-target-does-not-reuse-A", []);
  });

  test("A仍播放时转本地目标保留原清源及再次播放路径", async () => {
    const localUrl = "blob:biu-prefetch-local-playing";
    usePlayList
      .getState()
      .addList([
        { type: "audio", source: "local", id: "fixture-local-playing", audioUrl: localUrl, title: "Synthetic local" },
      ]);
    const target = usePlayList.getState().list.find(item => item.source === "local");
    if (!target) throw new Error("Local fixture was not added");
    const audio = usePlayList.getState().getAudio();
    expect(audio.paused).toBe(false);
    const requestsBefore = fixture!.arrivals.length;
    await usePlayList.getState().playListItem(target.id);
    const afterSelect = {
      sourceEmpty: audio.src === "",
      paused: audio.paused,
      isPlaying: usePlayList.getState().isPlaying,
    };
    expect(afterSelect).toEqual({ sourceEmpty: true, paused: true, isPlaying: false });
    expect(usePlayList.getState().getPlayItem()?.audioUrl).toBe(localUrl);
    usePlayList.getState().togglePlay();
    await until(() => audio.src === localUrl && !audio.paused, "original local explicit play path");
    expect(fixture!.arrivals).toHaveLength(requestsBefore);
    console.info(
      "PREFETCH_LOCAL_BOUNDARY",
      JSON.stringify({
        name: "playing-to-local",
        scope: "synthetic Audio/blob capability; real store; no file decoding claim",
        afterSelect,
        afterExplicitPlay: {
          localSourceUsed: audio.src === localUrl,
          paused: audio.paused,
          isPlaying: usePlayList.getState().isPlaying,
        },
        newUpstreamRequests: fixture!.arrivals.length - requestsBefore,
      }),
    );
  });

  test("A已暂停时转本地目标保留原已就绪播放路径", async () => {
    const localUrl = "blob:biu-prefetch-local-paused";
    usePlayList
      .getState()
      .addList([
        { type: "audio", source: "local", id: "fixture-local-paused", audioUrl: localUrl, title: "Synthetic local" },
      ]);
    const target = usePlayList.getState().list.find(item => item.source === "local");
    if (!target) throw new Error("Local fixture was not added");
    const audio = usePlayList.getState().getAudio();
    usePlayList.getState().togglePlay();
    expect(audio.paused).toBe(true);
    const requestsBefore = fixture!.arrivals.length;
    await usePlayList.getState().playListItem(target.id);
    await until(() => audio.src === localUrl && !audio.paused, "original local ready-source path");
    expect(fixture!.arrivals).toHaveLength(requestsBefore);
    console.info(
      "PREFETCH_LOCAL_BOUNDARY",
      JSON.stringify({
        name: "paused-to-local",
        scope: "synthetic Audio/blob capability; real store; no file decoding claim",
        afterSelect: {
          localSourceUsed: audio.src === localUrl,
          paused: audio.paused,
          isPlaying: usePlayList.getState().isPlaying,
        },
        newUpstreamRequests: fixture!.arrivals.length - requestsBefore,
      }),
    );
  });

  test("B预取及选曲在途时改选C，迟到B不抢播", async () => {
    await prefetchB();
    fixture!.phase("select-B");
    await select("B");
    await new Promise(resolve => setTimeout(resolve, 100));
    const phases: unknown[] = [{ phase: "B-selected-deadline", bArrivals: fixture!.bRequests().length }];
    fixture!.phase("select-C");
    await select("C");
    await waitPlaying("C");
    const source = usePlayList.getState().getAudio().src;
    phases.push({ phase: "C-playing-before-B-release", state: snapshot() });
    phases.push({ phase: "release", ids: fixture!.release() });
    await fixture!.settle();
    await until(
      () => Boolean(usePlayList.getState().list[1].audioUrl),
      "late prefetch B written only to its queue item",
    );
    expect(usePlayList.getState().getAudio().src).toBe(source);
    expect(snapshot()).toMatchObject({ currentTrack: "C", isPlaying: true, audioPaused: false });
    expect(fixture!.bRequests()).toHaveLength(2);
    expect(fixture!.bRequests().every(entry => entry.finished && !entry.earlyClose)).toBe(true);
    emitResult("late-B-after-C", phases);
  });

  test("B后台预取失败保留A，重复同pair时间事件不自动重试", async () => {
    await prefetchB();
    const phases: unknown[] = [{ phase: "release-error", ids: fixture!.release("http-500") }];
    await fixture!.settle();
    await new Promise(resolve => setTimeout(resolve, 100));
    fixture!.phase("repeat-timeupdate");
    usePlayList.getState().getAudio().ontimeupdate?.(new Event("timeupdate"));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(usePlayList.getState().list[1].audioUrl).toBeUndefined();
    expect(snapshot()).toMatchObject({ currentTrack: "A", isPlaying: true, audioPaused: false });
    expect(fixture!.bRequests()).toHaveLength(1);
    emitResult("prefetch-http-500", phases);
  });
});
