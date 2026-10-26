import type { NextFunction, Request, Response } from "express";

// 每种失败给出用户能据此行动的文案，不做统一兜底：被 B 站限流、歌词不对、服务器出错，用户该做的事完全不同，
// 统一说「网络请求失败」会让人反复手动重试，反而把限流打得更狠（AGENTS.md「错误处理」）。
const CATALOG = {
  BAD_REQUEST: [400, "请求参数不对"],
  UNAUTHORIZED: [401, "登录已过期，请重新登录 B 站后再试"],
  FORBIDDEN: [403, "只有审核员可以做这个操作"],
  LYRICS_EMPTY: [422, "歌词去掉制作人员信息和空行后是空的，没法对齐"],
  LYRICS_TOO_LONG: [422, "歌词太长了（超过 300 行或 2 万字），请检查是不是粘贴了多首"],
  LYRICS_UNSUPPORTED: [422, "暂时只支持中文、日语、韩语和英语歌词，其他语言还在做"],
  LYRICS_MISMATCH: [422, "歌词和这首歌的音频对不上，可能不是这首歌的歌词，或者是另一个版本"],
  AUDIO_TOO_SHORT: [422, "歌词比音频还长，可能不是这首歌的歌词"],
  VIDEO_NOT_FOUND: [404, "找不到这个投稿或分 P，可能已被删除或设为仅自己可见"],
  VIDEO_TOO_LONG: [422, "投稿超过 10 分钟，暂不做歌词对齐"],
  BILIBILI_RATE_LIMITED: [503, "B 站暂时限制了服务器的访问，请过半小时再试，连续重试会延长限制"],
  AUDIO_PCDN_ONLY: [503, "B 站这次只给了不稳定的 PCDN 节点，请过一会儿再试"],
  AUDIO_DOWNLOAD_FAILED: [502, "从 B 站下载音频失败，请过一会儿再试"],
  VIDEO_PCDN_ONLY: [503, "视频画面下载失败，暂时无法识别歌词。"],
  VIDEO_DOWNLOAD_FAILED: [502, "视频画面下载失败，暂时无法识别歌词。"],
  SCREEN_UNSUPPORTED: [501, "这台对齐服务器不支持从视频画面识别歌词"],
  SCREEN_FAILED: [500, "服务器识别视频画面时出错，已记录，请稍后再试"],
  SCREEN_TIMEOUT: [504, "识别视频画面超时，服务器可能太忙，请稍后再试"],
  SEPARATION_FAILED: [500, "服务器分离人声时出错，已记录，请稍后再试"],
  ALIGN_FAILED: [500, "服务器对齐时出错，已记录，请稍后再试"],
  ALIGN_TIMEOUT: [504, "对齐超时，服务器可能太忙，请稍后再试"],
  RATE_LIMITED: [429, "请求太频繁了，请稍等一下"],
  JOB_NOT_FOUND: [404, "找不到这个对齐任务，可能服务器重启过，请重新提交"],
  ALIGNMENT_NOT_READY: [409, "这份歌词还没对齐完成，等对齐完再操作"],
  ALIGNMENT_WITHDRAWN: [422, "这份歌词的时间轴被确认有误，已经下线；可以上传正确的歌词"],
  ALREADY_APPROVED: [409, "这份歌词已经是这首歌正在使用的版本"],
  SUBMISSION_NOT_FOUND: [404, "找不到这条提交"],
  SUBMISSION_NOT_PENDING: [409, "这条提交已经处理过了"],
  REJECT_REASON_REQUIRED: [400, "打回时要写原因，上传者会看到"],
  REPORT_NOT_FOUND: [404, "找不到这条报错"],
  REPORT_NOT_PENDING: [409, "这条报错已经处理过了"],
} as const satisfies Record<string, readonly [number, string]>;

export type AlignErrorCode = keyof typeof CATALOG;

export class AlignError extends Error {
  constructor(
    readonly code: AlignErrorCode,
    detail?: string,
  ) {
    super(detail ?? CATALOG[code][1]);
  }

  get status() {
    return CATALOG[this.code][0];
  }

  get userMessage() {
    return CATALOG[this.code][1];
  }

  toJSON() {
    return { code: this.code, message: this.userMessage };
  }
}

export const isAlignErrorCode = (code: string): code is AlignErrorCode => code in CATALOG;

// Express 靠「4 个参数」认出错误处理中间件，_next 用不到也不能删
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AlignError) {
    if (err.status >= 500) console.error(`[${err.code}]`, err.message);
    res.status(err.status).json({ error: err.toJSON() });
    return;
  }
  // express.json 解析失败
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: new AlignError("BAD_REQUEST").toJSON() });
    return;
  }
  console.error("[unhandled]", err);
  res.status(500).json({ error: new AlignError("ALIGN_FAILED").toJSON() });
}
