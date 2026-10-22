import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ProviderLyricsCandidate,
  ProviderLyricsDocument,
  ProviderLyricsGetParams,
  ProviderLyricsSearchParams,
  ProviderResult,
} from "@shared/lyrics-providers";

import { autoMatchLyrics, extractSongInfo, extractTitleCandidates } from "@/components/lyrics/auto-match";
import { parseLrcText } from "@shared/lyrics-format";

import searches from "./fixtures/lyrics-auto-match-search.json";

const mocks = vi.hoisted(() => ({
  searchNeteaseSongs: vi.fn<(params: SearchSongByNeteaseParams) => Promise<SearchSongByNeteaseResponse>>(),
  getNeteaseLyrics: vi.fn<(params: GetLyricsByNeteaseParams) => Promise<GetLyricsByNeteaseResponse>>(),
  searchLrclibLyrics: vi.fn<(params: SearchSongByLrclibParams) => Promise<SearchSongByLrclibResponse[]>>(),
  searchProviderLyrics:
    vi.fn<(params: ProviderLyricsSearchParams) => Promise<ProviderResult<ProviderLyricsCandidate[]>>>(),
  getProviderLyrics: vi.fn<(params: ProviderLyricsGetParams) => Promise<ProviderResult<ProviderLyricsDocument>>>(),
}));
vi.mock("@/platform", () => ({ default: mocks }));

// 搜索元数据来自 2026-10-22 网易云接口快照；时长单位为毫秒，歌词用自造文本避免把正文放入仓库。
const results: Record<string, NeteaseSong[]> = searches;
const lyrics = (id: number) => `[00:01.00]测试歌曲 ${id}\n[00:02.00]第二行\n[00:03.00]第三行`;
const jinbocho = "邪神酱 / 神保町哀歌 完整版 （CV： 铃木爱奈 ）";
const sakasama = "冰之城墙 ED主题歌 逆様";
const oldCase = "超时空辉夜姬 ED「ray 超かぐや姫！Version」/ 夏吉优子、早见沙织";

// 渠道冷却与自动预算是模块级状态，每个用例把时钟推到一小时后，让上一个用例留下的状态过期
let clock = Date.parse("2026-10-23T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  clock += 3_600_000;
  vi.setSystemTime(clock);
  mocks.searchProviderLyrics.mockResolvedValue({ ok: true, data: [] });
  mocks.getProviderLyrics.mockResolvedValue({
    ok: false,
    error: { kind: "not_found", provider: "qq", message: "没有这份歌词" },
  });
  mocks.searchNeteaseSongs.mockImplementation(async ({ s }) => ({ code: 200, result: { songs: results[s] ?? [] } }));
  mocks.getNeteaseLyrics.mockImplementation(async ({ id }) => ({
    lrc: { lyric: [3437238190, 3353527135].includes(id) ? "" : lyrics(id) },
  }));
  mocks.searchLrclibLyrics.mockResolvedValue([]);
});

afterEach(() => vi.useRealTimers());

async function match(title: string, duration?: number, isCanceled?: () => boolean) {
  const pending = autoMatchLyrics(title, duration, isCanceled);
  await vi.runAllTimersAsync();
  return pending;
}

describe("歌名提取：已登记案例与相邻写法", () => {
  it.each([
    [oldCase, "ray 超かぐや姫！Version"],
    [jinbocho, "神保町哀歌"],
    [sakasama, "逆様"],
    ["冰之城墙 ED 逆様", "逆様"],
    ["冰之城墙 片尾曲：逆様", "逆様"],
    ["冰之城墙 ED主题歌 逆様 / Polkadot Stingray", "逆様"],
    ["《冰之城墙》ED主题歌 逆様", "逆様"],
    ["『冰之城墙』ED「逆様」", "逆様"],
    ["Ed Sheeran - Perfect", "Perfect"],
    ["Linkin Park - In The End", "In The End"],
    ["UNISON SQUARE GARDEN「オリオンをなぞる」", "オリオンをなぞる"],
    ["韦礼安-如果可以「如果可以我想和你回到那天相遇」", "如果可以"],
    ["【高音质】《夜に駆ける》完整版", "夜に駆ける"],
  ])("%s → %s", (title, expected) => {
    expect(extractTitleCandidates(title)[0]).toBe(expected);
    expect(extractSongInfo(title).title).toBe(expected);
    expect(extractTitleCandidates(title).length).toBeLessThanOrEqual(4);
  });
});

describe("网易云自动采用", () => {
  it("旧案例仍采用带演唱者证据的歌曲", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({
      result: {
        songs: [{ id: 1, name: "ray 超かぐや姫！Version", artists: [{ name: "夏吉優子" }], duration: 300000 }],
      },
    });
    expect(await match(oldCase, 300)).toMatchObject({ lyrics: lyrics(1), from: "netease" });
  });

  it("神保町哀歌相差约 6 秒仍选原唱，不让更接近时长的空歌词翻唱抢占", async () => {
    expect(await match(jinbocho, 607)).toMatchObject({ lyrics: lyrics(1439125412), from: "netease" });
    expect(mocks.getNeteaseLyrics).toHaveBeenCalledExactlyOnceWith({ id: 1439125412 });
  });

  it("逆様按明确主题歌语境、精确歌名和 1 秒时差匹配", async () => {
    expect(await match(sakasama, 172)).toMatchObject({ lyrics: lyrics(3367822213), from: "netease" });
    expect(mocks.searchNeteaseSongs.mock.calls[0][0].s).toBe("逆様");
  });

  it("缺少专辑名不是无歌词的证据", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({
      result: { songs: [{ id: 1, name: "没有专辑的歌", duration: 180000 }] },
    });
    expect(await match("没有专辑的歌", 180)).toMatchObject({ lyrics: lyrics(1) });
  });

  it("前两名返回空歌词时继续第三名；时长仍按原有容差", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({
      result: {
        songs: [
          { id: 3437238190, name: "神保町哀歌", duration: 607000 },
          { id: 3353527135, name: "神保町哀歌", duration: 606000 },
          { id: 1439125412, name: "神保町哀歌", duration: 601146 },
        ],
      },
    });
    expect(await match("神保町哀歌", 607)).toMatchObject({ lyrics: lyrics(1439125412) });
    expect(mocks.getNeteaseLyrics.mock.calls.map(([p]) => p.id)).toEqual([3437238190, 3353527135, 1439125412]);
  });

  it.each([undefined, 0, 175])("短歌名缺失或偏离精确时长 %s 时保持保守", async duration => {
    expect(await match(sakasama, duration)).toBeNull();
    expect(mocks.getNeteaseLyrics).not.toHaveBeenCalled();
  });

  it("无主题歌语境的短歌名仍需演唱者证据", async () => {
    expect(await match("逆様", 172)).toBeNull();
  });

  it("一个字的主题歌名仍需演唱者证据", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({
      result: { songs: [{ id: 1, name: "谜", duration: 180000, artists: [{ name: "陌生歌手" }] }] },
    });
    expect(await match("某动画 ED 谜", 180)).toBeNull();
  });

  it("短歌名有演唱者证据时保留 12 秒容差与异体字折叠", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({
      result: { songs: [{ id: 1, name: "謎", duration: 180000, artists: [{ name: "小松未歩" }] }] },
    });
    expect(await match("小松未步 - 谜", 187)).toMatchObject({ lyrics: lyrics(1) });
  });

  it("非主题歌仍保留通过完整别名匹配的旧行为", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({
      result: { songs: [{ id: 1, name: "風", alias: ["随风而去"], duration: 180000 }] },
    });
    expect(await match("随风而去", 180)).toMatchObject({ lyrics: lyrics(1) });
  });

  it("两个不同歌手都精确同名同长时放弃猜测", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({
      result: {
        songs: [
          { id: 1, name: "逆様", duration: 171000, artists: [{ name: "歌手甲" }] },
          { id: 2, name: "逆様", duration: 172000, artists: [{ name: "歌手乙" }] },
        ],
      },
    });
    expect(await match(sakasama, 172)).toBeNull();
  });

  it("时长相近但只有部分歌名相同不视为短歌名证据", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({
      result: { songs: [{ id: 1, name: "逆様ブリッジ", duration: 172000, artists: [{ name: "歌手甲" }] }] },
    });
    expect(await match(sakasama, 172)).toBeNull();
  });

  it("有语境和时长但缺少候选演唱者信息时不猜测", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({ result: { songs: [{ id: 1, name: "逆様", duration: 172000 }] } });
    expect(await match(sakasama, 172)).toBeNull();
  });

  it("同一歌手的重复发行不算不同歌手歧义", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({
      result: {
        songs: [
          { id: 1, name: "逆様", duration: 171000, artists: [{ name: "同一歌手" }] },
          { id: 2, name: "逆様", duration: 172000, artists: [{ name: "同一歌手" }] },
        ],
      },
    });
    expect(await match(sakasama, 172)).toMatchObject({ lyrics: lyrics(2) });
  });

  it("后续较长关键词也不绕过短歌名的歧义保护", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({
      result: {
        songs: [
          { id: 1, name: "逆様", duration: 171000, artists: [{ name: "歌手甲" }] },
          { id: 2, name: "逆様", duration: 172000, artists: [{ name: "歌手乙" }] },
        ],
      },
    });
    expect(await match("片尾曲 逆様", 172)).toBeNull();
  });

  it("一般匹配的 12 秒上限没有放宽", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({
      result: { songs: [{ id: 1, name: "神保町哀歌", duration: 601000 }] },
    });
    expect(await match("神保町哀歌", 613)).toMatchObject({ lyrics: lyrics(1) });
    expect(await match("神保町哀歌", 614)).toBeNull();
  });

  it("取消后的任务不请求歌词也不落入兜底渠道", async () => {
    let canceled = false;
    mocks.searchNeteaseSongs.mockImplementation(async () => {
      canceled = true;
      return { result: { songs: results["神保町哀歌"] } };
    });
    expect(await match(jinbocho, 607, () => canceled)).toBeNull();
    expect(mocks.getNeteaseLyrics).not.toHaveBeenCalled();
    expect(mocks.searchLrclibLyrics).not.toHaveBeenCalled();
  });
});

describe("LrcLib 兜底使用相同的短歌名限制", () => {
  const song = { id: 1, trackName: "逆様", artistName: "Polkadot Stingray", duration: 171, syncedLyrics: lyrics(1) };

  beforeEach(() => {
    mocks.searchNeteaseSongs.mockResolvedValue({ result: { songs: [] } });
    mocks.searchLrclibLyrics.mockResolvedValue([song]);
  });

  it("主题歌语境下精确同名同长的唯一候选可采用", async () => {
    expect(await match(sakasama, 172)).toEqual({ lyrics: lyrics(1), from: "lrclib" });
  });

  it("无语境的两字歌名不放宽", async () => {
    expect(await match("逆様", 172)).toBeNull();
  });

  it("两个不同歌手都符合条件时不猜测", async () => {
    mocks.searchLrclibLyrics.mockResolvedValue([song, { ...song, id: 2, artistName: "另一歌手" }]);
    expect(await match(sakasama, 172)).toBeNull();
  });

  it.each(["", "[00:00.00]纯音乐，请欣赏", "没有时间戳的文本"])("不采用空或无有效正文的歌词 %s", async text => {
    mocks.searchLrclibLyrics.mockResolvedValue([{ ...song, syncedLyrics: text }]);
    expect(await match(sakasama, 172)).toBeNull();
  });
});

describe("QQ / 酷狗 / AMLL 兜底", () => {
  const body = "[00:01.00]第一行\n[00:02.00]第二行\n[00:170.00]末行".replace("00:170.00", "02:50.00");
  const doc = (provider: "qq" | "kugou" | "amll", text = body): ProviderLyricsDocument => ({
    provider,
    sourceId: "s1",
    lyrics: parseLrcText(text),
  });
  const cand = (
    provider: "qq" | "kugou" | "amll",
    extra: Partial<ProviderLyricsCandidate> = {},
  ): ProviderLyricsCandidate => ({
    provider,
    id: `${provider}-1`,
    title: "晴天",
    artists: ["周杰伦"],
    durationMs: 180000,
    ...extra,
  });
  const only = (provider: string, candidate: ProviderLyricsCandidate) => {
    mocks.searchProviderLyrics.mockImplementation(async p => ({
      ok: true,
      data: p.provider === provider ? [candidate] : [],
    }));
    mocks.getProviderLyrics.mockImplementation(async p => ({ ok: true, data: doc(p.provider) }));
  };

  beforeEach(() => {
    mocks.searchNeteaseSongs.mockResolvedValue({ result: { songs: [] } });
    mocks.searchLrclibLyrics.mockResolvedValue([]);
  });

  it("网易云、LrcLib 都没命中时按 QQ → 酷狗 → AMLL 顺序兜底，命中即停", async () => {
    only("kugou", cand("kugou"));
    const hit = await match("周杰伦 - 晴天", 180);
    expect(hit).toMatchObject({ from: "kugou", origin: { provider: "kugou" } });
    expect([...new Set(mocks.searchProviderLyrics.mock.calls.map(([p]) => p.provider))]).toEqual(["qq", "kugou"]);
  });

  it("网易云命中时完全不碰这三个渠道", async () => {
    mocks.searchNeteaseSongs.mockResolvedValue({
      result: { songs: [{ id: 1, name: "七里香", duration: 180000 }] },
    });
    expect(await match("七里香", 180)).toMatchObject({ from: "netease" });
    expect(mocks.searchProviderLyrics).not.toHaveBeenCalled();
  });

  it("视频时长未知时不兜底", async () => {
    only("qq", cand("qq"));
    expect(await match("周杰伦 - 晴天")).toBeNull();
    expect(mocks.searchProviderLyrics).not.toHaveBeenCalled();
  });

  it("时长差超过 12 秒的候选不采用", async () => {
    only("qq", cand("qq", { durationMs: 200000 }));
    expect(await match("周杰伦 - 晴天", 180)).toBeNull();
  });

  it("AMLL 没有曲库时长：标题里要有歌手，且歌词末行要落在视频时长内", async () => {
    only("amll", cand("amll", { durationMs: undefined }));
    expect(await match("周杰伦 - 晴天", 180)).toMatchObject({ from: "amll" });
    expect(await match("晴天", 180)).toBeNull();
    // 末行 02:50 相对 100 秒的视频太晚
    expect(await match("周杰伦 - 晴天", 100)).toBeNull();
  });

  it("限流后该渠道本轮不再请求，其他渠道照常兜底", async () => {
    mocks.searchProviderLyrics.mockImplementation(async p =>
      p.provider === "qq"
        ? { ok: false, error: { kind: "rate_limited", provider: "qq", message: "x", retryAfterMs: 90_000 } }
        : { ok: true, data: p.provider === "amll" ? [cand("amll")] : [] },
    );
    mocks.getProviderLyrics.mockImplementation(async p => ({ ok: true, data: doc(p.provider) }));
    expect(await match("周杰伦 - 晴天", 180)).toMatchObject({ from: "amll" });
    const qqCalls = () => mocks.searchProviderLyrics.mock.calls.filter(([p]) => p.provider === "qq").length;
    expect(qqCalls()).toBe(1);
    await match("周杰伦 - 晴天", 180);
    expect(qqCalls()).toBe(1);
  });

  it("自动匹配每渠道每分钟最多占 12 次请求", async () => {
    const sentAt: number[] = [];
    mocks.searchProviderLyrics.mockImplementation(async p => {
      if (p.provider === "qq") sentAt.push(Date.now());
      return { ok: true, data: [] };
    });
    for (let i = 0; i < 20; i++) await match(`周杰伦 - 歌${i}`, 180);
    expect(sentAt.length).toBeGreaterThan(12);
    for (const t of sentAt) expect(sentAt.filter(x => x <= t && x > t - 60_000).length).toBeLessThanOrEqual(12);
  });

  it("取词返回无有效正文时换下一个候选", async () => {
    mocks.searchProviderLyrics.mockImplementation(async p => ({
      ok: true,
      data: p.provider === "qq" ? [cand("qq", { id: "a" }), cand("qq", { id: "b", durationMs: 181000 })] : [],
    }));
    mocks.getProviderLyrics.mockImplementation(async p => ({
      ok: true,
      data: doc("qq", p.id === "a" ? "[00:01.00]纯音乐" : body),
    }));
    expect(await match("周杰伦 - 晴天", 180)).toMatchObject({ from: "qq" });
    expect(mocks.getProviderLyrics).toHaveBeenCalledTimes(2);
  });
});
