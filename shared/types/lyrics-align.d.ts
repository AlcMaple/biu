// 与 biu-align-server/src/lib/result.ts、submissions.ts 的返回结构对齐

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
  quality: { medianScore: number; lowScoreLines: number; repairedLines: number };
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

interface AlignSubmissionDetail {
  submission: AlignSubmissionBrief & { lines: { t: number | null; text: string }[] };
  alignment: LyricsAlignment | null;
  current: LyricsAlignment | null;
}
