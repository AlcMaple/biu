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
  /(合集|歌单|串烧|联唱|medley|mashup|混剪|直拍|翻跳|对比|测评|评测|开箱|拆箱|vlog|盘点|排行|top\s*\d|一小时|1\s*小时|半小时|\d{2,}\s*首|循环\s*歌|\bloop\b|repeat|教学|教程|扒谱|reaction|react\b|解说|讲解|直播|录播|回放|全专|专辑|电台|采访|剪辑)/i;

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
  if (c.tname && TNAME_BLOCK.test(c.tname)) return false;
  return true;
}
