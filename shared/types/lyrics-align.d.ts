// 与 biu-align-server/src/lib/result.ts、submissions.ts、reports.ts 的返回结构对齐

interface AlignRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

// 传输层不抛业务错误：status + 原样的响应体交给渲染层，错误文案用服务端给的 error.message
interface AlignResponse {
  status: number;
  data: unknown;
}

interface AlignedLyricLine {
  /** 秒 */
  start: number;
  text: string;
  words: { text: string; start: number }[];
  score: number;
  repaired?: true;
}

interface LyricsAlignment {
  alignerVersion: number;
  bvid: string;
  cid: string;
  lyricsHash: string;
  video: { title: string; part?: string; durationSec: number };
  lines: AlignedLyricLine[];
  quality: {
    // 对齐算法 2 版起才有；之前缓存下来的只有中文
    lang?: "zh" | "ja" | "ko" | "en";
    medianScore: number;
    lowScoreLines: number;
    repairedLines: number;
    timelineMatch?: number | null;
  };
  offsetSec: number;
  lrc: string;
  createdAt: number;
}

type AlignJobState = "queued" | "running" | "done" | "failed";

interface AlignJobView {
  id: string | null;
  state: AlignJobState;
  stage?: "download" | "align";
  position?: number;
  alignment?: LyricsAlignment;
  error?: { code: string; message: string };
}

type AlignSubmissionStatus = "pending" | "approved" | "rejected" | "withdrawn" | "superseded";

interface AlignSubmissionBrief {
  id: string;
  bvid: string;
  cid: string;
  mid: string;
  lyricsHash: string;
  title: string;
  status: AlignSubmissionStatus;
  note?: string;
  reason?: string;
  createdAt: number;
  reviewedAt?: number;
  lineCount: number;
}

/** 对所有人生效的版本从哪来：auto = 第一位听众自动对齐；upload = 用户上传后审核通过；admin = 管理员手动发布 */
type AlignPublishSource = "auto" | "upload" | "admin";

interface AlignPublished {
  alignment: LyricsAlignment | null;
  source: AlignPublishSource | null;
}

interface AlignSubmissionDetail {
  submission: AlignSubmissionBrief & { lines: { t: number | null; text: string }[] };
  /** 服务端还在对齐时为 null */
  alignment: LyricsAlignment | null;
  /** 对齐失败（歌词和音频对不上等）时有 */
  failure: { code: string; message: string } | null;
  current: LyricsAlignment | null;
  currentSource: AlignPublishSource | null;
}

type AlignReportStatus = "pending" | "resolved" | "dismissed";

interface AlignReport {
  id: string;
  bvid: string;
  cid: string;
  mid: string;
  lyricsHash: string;
  title: string;
  note: string;
  /** 报错时那份是不是对所有人生效的版本；不是说明报错人自己换过歌词 */
  wasPublished: boolean;
  status: AlignReportStatus;
  reason?: string;
  /** 处理时同时下线了那份 */
  withdrawn?: boolean;
  createdAt: number;
  reviewedAt?: number;
}

interface AlignReportDetail {
  report: AlignReport;
  alignment: LyricsAlignment | null;
  current: LyricsAlignment | null;
  currentSource: AlignPublishSource | null;
}
