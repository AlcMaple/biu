import { apiRequest } from "./request";

/**
 * 「相关视频」推荐（看了又看）列表项。取自 archive/related，字段与 view 卡片近似。
 */
export interface ArchiveRelatedItem {
  aid: number;
  bvid: string;
  cid?: number;
  title: string;
  pic: string;
  /** 稿件总时长（秒） */
  duration: number;
  /** 子分区 tid */
  tid?: number;
  /** 子分区名称 */
  tname?: string;
  owner?: { mid: number; name: string; face?: string };
  stat?: { view?: number; danmaku?: number; like?: number };
}

export interface ArchiveRelatedResponse {
  code: number;
  message: string;
  ttl: number;
  data: ArchiveRelatedItem[];
}

/**
 * 相关视频推荐（看了又看）。给定一个稿件 bvid，返回 B 站的相关推荐列表。
 * 这是 B 站原生的「共看相似」信号，作为心动模式候选来源之一（需再过一遍单曲过滤）。
 *
 * GET /x/web-interface/archive/related
 */
export function getWebInterfaceArchiveRelated(bvid: string): Promise<ArchiveRelatedResponse> {
  return apiRequest.get<ArchiveRelatedResponse>("/x/web-interface/archive/related", {
    params: { bvid },
  });
}
