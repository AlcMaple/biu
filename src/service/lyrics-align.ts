import platform from "@/platform";

// 失败时带着服务端给的 error.message 原样抛出：限流、配额、歌词对不上，用户该做的事各不相同，不能统一成「网络请求失败」
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

export const createAlignJob = (body: { bvid: string; cid: string; lyrics: string }) =>
  call<AlignJobView>({ method: "POST", path: "/align/jobs", body });

export const getAlignJob = (id: string) => call<AlignJobView>({ method: "GET", path: `/align/jobs/${id}` });

export const getApprovedLyrics = (bvid: string, cid: string) =>
  call<{ alignment: LyricsAlignment | null }>({ method: "GET", path: `/lyrics/${bvid}/${cid}` });

export const submitLyrics = (body: { bvid: string; cid: string; lyrics: string; note?: string }) =>
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
