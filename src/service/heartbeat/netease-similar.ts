import { NETEASE_TOP_K } from "@/common/constants/heartbeat";
import { isPureSongCandidate, toSeconds, type SongCandidate } from "@/common/utils/pure-song";
import platform from "@/platform";
import { getWebInterfaceWbiSearchType, type SearchVideoItem } from "@/service/web-interface-search-type";

// —— 熔断：回程 B站搜索被风控（-412/-352）时，本次运行内冷却一段 ——
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;
let breakerUntil = 0;
const breakerTripped = () => Date.now() < breakerUntil;
const tripBreaker = () => {
  breakerUntil = Date.now() + BREAKER_COOLDOWN_MS;
};

// 回程缓存：歌名关键词 → B站候选（null = 搜过但没有），一次运行内不重复搜同一首
const biliCache = new Map<string, SongCandidate | null>();

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "");

/** 清洗 B站脏标题用于网易搜索：去括号内容 + 常见修饰词，保留核心词与空格 */
function cleanForSearch(title: string): string {
  return title
    .replace(/[【[（(「『《<].*?[】\]）)」』>》]/g, " ")
    .replace(/中日|中文|双语|字幕|中字|歌词|完整版|官方|4k|8k|hd|无损|hi-?res|高音质|cover|翻唱|remix|搬运|首发/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 回程：拿一个「歌手 歌名」去 B站搜，挑出第一条通过单曲过滤的视频 */
async function biliFindSong(name: string, artist?: string): Promise<SongCandidate | null> {
  const keyword = `${name} ${artist ?? ""}`.trim();
  if (biliCache.has(keyword)) return biliCache.get(keyword) ?? null;
  if (breakerTripped()) return null;

  try {
    const res = await getWebInterfaceWbiSearchType<SearchVideoItem>({
      search_type: "video",
      keyword,
      page: 1,
      page_size: 10,
      order: "totalrank",
      tids: 3,
    });
    if (res.code === -412 || res.code === -352) {
      tripBreaker();
      return null;
    }
    for (const it of res?.data?.result ?? []) {
      const cand: SongCandidate = {
        bvid: it.bvid,
        title: stripHtml(it.title ?? ""),
        durationSec: toSeconds(it.duration),
        cover: it.pic,
        ownerMid: it.mid,
        ownerName: stripHtml(it.author ?? ""),
        play: it.play,
      };
      if (isPureSongCandidate(cand)) {
        biliCache.set(keyword, cand);
        return cand;
      }
    }
    biliCache.set(keyword, null);
    return null;
  } catch {
    return null;
  }
}

/**
 * 第三条腿：一首红心歌 → 网易搜到曲目 id → 相似歌名（同曲风异歌手）→ 回搜 B站单曲。
 * 全程 try/catch，任一步失败/搜不到都返回空（失败即静默，交给其它两条腿兜底）。
 *
 * 只用清洗后的歌名去搜网易，不带 B站 UP 名 —— 搬运频道名不是歌手，带上反而降低匹配率。
 */
export async function fromNeteaseSimilar(title?: string): Promise<SongCandidate[]> {
  if (!title || breakerTripped()) return [];

  try {
    const q = cleanForSearch(title);
    if (!q) return [];

    // 去程：清洗后的标题 → 网易曲目 id
    const searchRes = await platform.searchNeteaseSongs({ s: q, type: 1, limit: 1, offset: 0 });
    const songId = searchRes?.result?.songs?.[0]?.id;
    if (!songId) return []; // 搜不到对应网易歌 → 静默空

    // 相似歌名
    const simi = await platform.getNeteaseSimilarSongs({ songid: songId, limit: NETEASE_TOP_K + 4 });
    const names = (simi?.songs ?? [])
      .slice(0, NETEASE_TOP_K)
      .map(s => ({ name: (s.name ?? "").trim(), artist: s.artists?.[0]?.name }))
      .filter(n => n.name);

    // 回程：每个歌名回搜 B站
    const found = await Promise.all(names.map(n => biliFindSong(n.name, n.artist)));
    return found.filter((c): c is SongCandidate => c !== null);
  } catch {
    return [];
  }
}
