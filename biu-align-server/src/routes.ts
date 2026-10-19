import { type NextFunction, type Request, type Response, Router } from "express";
import rateLimit from "express-rate-limit";

import type { AlignmentCache } from "./lib/alignment-cache.js";
import type { AlignQueue } from "./lib/queue.js";
import type { SubmissionStore, Submission } from "./lib/submissions.js";

import { type AuthedRequest, isAdmin, requireAdmin, requireAuth } from "./lib/auth.js";
import { AlignError } from "./lib/errors.js";
import { lyricsHash, parseLyrics, parseTarget } from "./lib/lyrics.js";
import { cacheKey } from "./lib/queue.js";

export interface RouteDeps {
  queue: AlignQueue;
  cache: AlignmentCache;
  submissions: SubmissionStore;
  rateLimitPerMinute: number;
}

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req as AuthedRequest, res).catch(next);
};

// 给投稿者看的列表不带整份歌词，减小响应体
const brief = ({ lines, ...rest }: Submission) => ({ ...rest, lineCount: lines.length });

export function createRouter(deps: RouteDeps): Router {
  const { queue, cache, submissions } = deps;
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: deps.rateLimitPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => (req as AuthedRequest).mid ?? req.ip ?? "unknown",
    handler: (_req, res) => {
      res.status(429).json({ error: new AlignError("RATE_LIMITED").toJSON() });
    },
  });

  router.get("/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  router.get(
    "/me",
    requireAuth,
    wrap(async (req, res) => res.json({ mid: req.mid, isAdmin: isAdmin(req.mid) })),
  );

  router.post(
    "/align/jobs",
    requireAuth,
    limiter,
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.body?.bvid, req.body?.cid);
      if (typeof req.body?.lyrics !== "string") throw new AlignError("BAD_REQUEST", "缺少 lyrics");
      const lines = parseLyrics(req.body.lyrics);
      const view = await queue.submit({ mid: req.mid!, bvid, cid, lyricsHash: lyricsHash(lines), lines });
      res.status(view.state === "done" ? 200 : 202).json(view);
    }),
  );

  router.get(
    "/align/jobs/:id",
    requireAuth,
    limiter,
    wrap(async (req, res) => res.json(queue.get(String(req.params.id)))),
  );

  router.post(
    "/lyrics/submissions",
    requireAuth,
    limiter,
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.body?.bvid, req.body?.cid);
      if (typeof req.body?.lyrics !== "string") throw new AlignError("BAD_REQUEST", "缺少 lyrics");
      const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 200) : undefined;
      const lines = parseLyrics(req.body.lyrics);
      const hash = lyricsHash(lines);
      // 必须先对齐成功（用户已经预览过效果）才能提交，审核员看到的就是用户看到的
      const alignment = await cache.get(cacheKey({ bvid, cid, lyricsHash: hash }));
      if (!alignment) throw new AlignError("ALIGNMENT_NOT_READY");
      const sub = await submissions.create({
        bvid,
        cid,
        mid: req.mid!,
        lyricsHash: hash,
        lines,
        title: alignment.video.title,
        ...(note ? { note } : {}),
      });
      res.status(201).json(brief(sub));
    }),
  );

  router.get(
    "/lyrics/submissions/mine",
    requireAuth,
    limiter,
    wrap(async (req, res) => res.json({ items: (await submissions.list(s => s.mid === req.mid)).map(brief) })),
  );

  // 必须注册在 /lyrics/submissions/mine 之后，否则 submissions/mine 会被当成 bvid/cid 吃掉。
  // 审核通过、对所有人生效的歌词；没有时返回 null 而不是 404，客户端每次打开歌都会查，404 会刷满错误日志
  router.get(
    "/lyrics/:bvid/:cid",
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.params.bvid, req.params.cid);
      const approved = await submissions.getApproved(bvid, cid);
      const alignment = approved
        ? await cache.get(cacheKey({ bvid, cid, lyricsHash: approved.lyricsHash }))
        : undefined;
      res.json({ alignment: alignment ?? null });
    }),
  );

  const admin = Router();
  admin.use(requireAuth, requireAdmin, limiter);

  admin.get(
    "/submissions",
    wrap(async (req, res) => {
      const status = typeof req.query.status === "string" ? req.query.status : "pending";
      res.json({ items: (await submissions.list(s => s.status === status)).map(brief) });
    }),
  );

  // 审核详情：这次提交的对齐结果 + 当前在用的版本，方便对比试听
  admin.get(
    "/submissions/:id",
    wrap(async (req, res) => {
      const sub = await submissions.get(String(req.params.id));
      const alignment = await cache.get(cacheKey(sub));
      const approved = await submissions.getApproved(sub.bvid, sub.cid);
      const current = approved
        ? await cache.get(cacheKey({ bvid: sub.bvid, cid: sub.cid, lyricsHash: approved.lyricsHash }))
        : undefined;
      res.json({ submission: sub, alignment: alignment ?? null, current: current ?? null });
    }),
  );

  admin.post(
    "/submissions/:id/approve",
    wrap(async (req, res) => {
      const sub = await submissions.get(String(req.params.id));
      // 对齐缓存丢了（换算法版本、磁盘清理）时不能放行，否则通过后所有人拿到的是空歌词
      if (!(await cache.get(cacheKey(sub)))) throw new AlignError("ALIGNMENT_NOT_READY");
      res.json(brief(await submissions.approve(sub.id, req.mid!)));
    }),
  );

  admin.post(
    "/submissions/:id/reject",
    wrap(async (req, res) => {
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";
      if (!reason) throw new AlignError("REJECT_REASON_REQUIRED");
      res.json(brief(await submissions.reject(String(req.params.id), req.mid!, reason)));
    }),
  );

  router.use("/admin", admin);
  return router;
}
