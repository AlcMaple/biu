import platform from "@/platform";

// 失败时带着服务端给的 error.message 原样抛出：限流、服务器出错、歌词对不上，用户该做的事各不相同，不能统一成「网络请求失败」
export class AlignApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(req: AlignRequest): Promise<T> {
  const { status, data } = await platform.alignRequest(req);
  if (status >= 200 && status < 300) return data as T;
  const error = (data as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const message = typeof error?.message === "string" ? error.message : `歌词对齐服务出错（HTTP ${status}）`;
  throw new AlignApiError(message, typeof error?.code === "string" ? error.code : "UNKNOWN", status);
}

export const getAlignMe = () => call<{ mid: string; isAdmin: boolean }>({ method: "GET", path: "/me" });

// manual 只对管理员生效：插到队首、跳过缓存重跑
export const createAlignJob = (body: { bvid: string; cid: string; lyrics: string; manual?: boolean }) =>
  call<AlignJobView>({ method: "POST", path: "/align/jobs", body });

export const getAlignJob = (id: string) => call<AlignJobView>({ method: "GET", path: `/align/jobs/${id}` });

export const getPublishedLyrics = (bvid: string, cid: string) =>
  call<AlignPublished>({ method: "GET", path: `/lyrics/${bvid}/${cid}` });

export const getRecognizedLyrics = (bvid: string, cid: string) =>
  call<AlignRecognized>({ method: "GET", path: `/lyrics/${bvid}/${cid}/recognized` });

export const putRecognizedLyrics = (
  body:
    | { bvid: string; cid: string; v: number; lyrics: string; tLyrics?: string; from: string }
    | { bvid: string; cid: string; v: number; missing: true },
) => call<{ stored: boolean }>({ method: "POST", path: "/lyrics/recognized", body });

export const submitLyrics = (body: { bvid: string; cid: string; lyrics: string; title: string; note?: string }) =>
  call<AlignSubmissionBrief>({ method: "POST", path: "/lyrics/submissions", body });

export const getMySubmissions = () =>
  call<{ items: AlignSubmissionBrief[] }>({ method: "GET", path: "/lyrics/submissions/mine" });

export const getReviewList = (status: AlignSubmissionStatus = "pending") =>
  call<{ items: AlignSubmissionBrief[] }>({ method: "GET", path: `/admin/submissions?status=${status}` });

export const getReviewDetail = (id: string) =>
  call<AlignSubmissionDetail>({ method: "GET", path: `/admin/submissions/${id}` });

export const approveSubmission = (id: string) =>
  call<AlignSubmissionBrief>({ method: "POST", path: `/admin/submissions/${id}/approve` });

export const rejectSubmission = (id: string, reason: string) =>
  call<AlignSubmissionBrief>({ method: "POST", path: `/admin/submissions/${id}/reject`, body: { reason } });

export const reportAlignment = (body: { bvid: string; cid: string; lyricsHash: string; note?: string }) =>
  call<AlignReport>({ method: "POST", path: "/lyrics/reports", body });

export const getMyReports = () => call<{ items: AlignReport[] }>({ method: "GET", path: "/lyrics/reports/mine" });

export const getReportList = (status: AlignReportStatus = "pending") =>
  call<{ items: AlignReport[] }>({ method: "GET", path: `/admin/reports?status=${status}` });

export const getReportDetail = (id: string) => call<AlignReportDetail>({ method: "GET", path: `/admin/reports/${id}` });

export const resolveReport = (id: string, body: { withdraw: boolean; reason?: string }) =>
  call<AlignReport>({ method: "POST", path: `/admin/reports/${id}/resolve`, body });

export const dismissReport = (id: string, reason: string) =>
  call<AlignReport>({ method: "POST", path: `/admin/reports/${id}/dismiss`, body: { reason } });

export const publishAlignment = (body: { bvid: string; cid: string; lyrics: string }) =>
  call<AlignPublished>({ method: "POST", path: "/admin/published", body });
