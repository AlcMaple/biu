import { SONG_MAX_SECONDS, SONG_MIN_SECONDS } from "@/common/constants/heartbeat";

/**
 * 候选归一化后的形状：各来源（同 UP 投稿 / 看了又看）统一到这里再过滤。
 */
export interface SongCandidate {
  bvid: string;
  title: string;
  /** 时长（秒） */
  durationSec: number;
  cover?: string;
  ownerMid?: number;
  ownerName?: string;
  /** 子分区名（部分来源才有） */
  tname?: string;
  /** 播放量（用于排序参考） */
  play?: number;
}

/** 把 "3:20" / "1:02:33" / 纯秒数 统一成秒 */
export const toSeconds = (d: number | string | undefined | null): number => {
  if (d == null) return 0;
  if (typeof d === "number") return Number.isFinite(d) ? d : 0;
  const parts = d.split(":").map(Number);
  if (!parts.length || parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};

/**
 * 标题命中即判为「非单曲」：合集 / 口播 / 教学 / 现场 / 长视频等。
 * 这是过滤噪声的主力（B 站音乐区搜索里大量 40 分钟循环歌单、reaction、直拍、测评）。
 */
const TITLE_BLOCK =
  /(合集|歌单|串烧|联唱|medley|mashup|混剪|直拍|翻跳|对比|测评|评测|开箱|拆箱|vlog|盘点|排行|top\s*\d|一小时|1\s*小时|半小时|\d{2,}\s*首|循环\s*歌|\bloop\b|repeat|教学|教程|扒谱|reaction|react\b|解说|讲解|直播|录播|回放|全专|专辑|电台|采访|剪辑|同台|演唱会|演唱會|the\s*first\s*take|ファースト・?テイク)/i;

/**
 * 中文听歌 reaction 常不写 reaction / 直播 / 切片，只用「让某人听某歌」「听完有什么反应」包装标题。
 * 保留正常歌名里的「听」（如「听海」「让我听懂你的语言」），只拦带明确体验者或反应语义的组合。
 */
const LISTENING_REACTION_BLOCK =
  /(?:让|讓|给|給).{1,24}(?:听|聽)(?:一?下)?(?:[《「『【“"]|.{0,40}(?:反[应應]|reaction))|(?:第一次|首次|初次).{0,6}(?:听|聽)(?!见|見)|(?:听|聽)(?:完|后|後|了)?.{0,40}(?:会有|會有|有什么|有什麼|怎样|怎樣|如何|的)反[应應]/i;

/** 子分区名命中即排除：现场有大量前后摇/报幕/掌声，电台/教学为口播。 */
const TNAME_BLOCK = /(现场|电台|教学|乐评|资讯|访谈)/;

/**
 * Stage 1：仅凭搜索/列表已返回的字段（时长 + 标题 + 子分区名）判断是否像「单曲」。
 * 纯函数、零请求，可单测。推荐场景走「精度优先」——宁可错杀，池子有的是。
 */
export function isPureSongCandidate(c: SongCandidate): boolean {
  if (!c.bvid) return false;
  if (c.durationSec < SONG_MIN_SECONDS || c.durationSec > SONG_MAX_SECONDS) return false;
  if (TITLE_BLOCK.test(c.title)) return false;
  if (LISTENING_REACTION_BLOCK.test(c.title)) return false;
  if (c.tname && TNAME_BLOCK.test(c.tname)) return false;
  return true;
}

/**
 * 从标题提取「歌曲指纹」用于同名去重：不同 UP 传的同一首歌（bvid 不同、标题略有差异）折叠成同一 key。
 * 去掉括号内容 + 常见修饰词 + 非字母数字，剩核心歌名。启发式，宁可偶尔错并（精度优先）。
 */
export function songKey(title: string): string {
  let t = (title ?? "").toLowerCase();
  t = t.replace(/[【[（(「『《<].*?[】\]）)」』>》]/g, " ");
  t = t.replace(
    /中日|中文|双语|字幕|中字|歌词|完整版|full|官方|官方版|\bmv\b|4k|8k|hd|1080p|无损|hi-?res|高音质|cover|翻唱|feat\.?|ft\.?|live|超清|谐音|纯音乐|伴奏|remix|重制|搬运|首发/gi,
    " ",
  );
  t = t.replace(/[^\p{L}\p{N}]/gu, "");
  return t || title.trim().toLowerCase();
}

/**
 * 同名判定：两个歌曲指纹相等，或较短者（≥4 字，避免超短名误并）是较长者的子串，即视为同一首歌。
 * 用子串包含而非精确相等，是为了吃下「裸歌名」vs「歌名+歌手名+歌词分配」这类同一首歌的不同投稿。
 */
export function isSameSong(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.includes(short);
}
