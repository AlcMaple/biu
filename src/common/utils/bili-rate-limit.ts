import { isAxiosError } from "axios";

// 口径与项目其他接口一致：HTTP 412/429，或 HTTP 200 里的业务码 -412（请求被拦截）/ -352（风控校验失败）
const RATE_LIMIT_HTTP_STATUS = new Set([412, 429]);
const RATE_LIMIT_CODES = new Set([-412, -352]);

export const BILI_RATE_LIMIT_MESSAGE = "被 B 站限流了，已暂停播放，请过几分钟再点播放";

export class BiliRateLimitError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(BILI_RATE_LIMIT_MESSAGE);
    this.name = "BiliRateLimitError";
    this.detail = detail;
  }
}

export const isBiliRateLimitStatus = (status?: number) =>
  typeof status === "number" && RATE_LIMIT_HTTP_STATUS.has(status);

export const isBiliRateLimitCode = (code?: number) => typeof code === "number" && RATE_LIMIT_CODES.has(code);

export const isBiliRateLimitError = (error: unknown): error is BiliRateLimitError =>
  error instanceof BiliRateLimitError;

export function assertNotRateLimitedResponse(res: { code?: number } | undefined, api: string) {
  if (isBiliRateLimitCode(res?.code)) throw new BiliRateLimitError(`${api} code ${res?.code}`);
}

export function toBiliRateLimitError(error: unknown, api: string): BiliRateLimitError | undefined {
  if (isBiliRateLimitError(error)) return error;
  if (isAxiosError(error) && isBiliRateLimitStatus(error.response?.status)) {
    return new BiliRateLimitError(`${api} HTTP ${error.response?.status}`);
  }
  return undefined;
}
