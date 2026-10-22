import { type NextFunction, type Request, type Response, Router } from "express";
import rateLimit from "express-rate-limit";

import type { AlignmentCache, FailureCache } from "./lib/alignment-cache.js";
import type { AlignQueue } from "./lib/queue.js";
import type { RecognizedStore } from "./lib/recognized.js";
import type { Report, ReportStore } from "./lib/reports.js";
import type { SubmissionStore, Submission } from "./lib/submissions.js";

import { type AuthedRequest, isAdmin, requireAdmin, requireAuth } from "./lib/auth.js";
import { AlignError } from "./lib/errors.js";
import { lyricsHash, MAX_CHARS, parseLyrics, parseTarget } from "./lib/lyrics.js";
import { cacheKey } from "./lib/queue.js";
import { RECOGNIZED_FROM, type RecognizedFrom, type RecognizedInput } from "./lib/recognized.js";

export interface RouteDeps {
  queue: AlignQueue;
  cache: AlignmentCache;
  failures: FailureCache;
  submissions: SubmissionStore;
  reports: ReportStore;
  recognized: RecognizedStore;
  rateLimitPerMinute: number;
}

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req as AuthedRequest, res).catch(next);
};

// 给投稿者看的列表不带整份歌词，减小响应体
const brief = ({ lines, ...rest }: Submission) => ({ ...rest, lineCount: lines.length });

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const parseHash = (value: unknown) => {
  if (typeof value !== "string" || !/^[0-9a-f]{16}$/.test(value))
    throw new AlignError("BAD_REQUEST", "lyricsHash 不对");
  return value;
};

export function createRouter(deps: RouteDeps): Router {
  const { queue, cache, failures, submissions, reports, recognized } = deps;
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

  const published = async (bvid: string, cid: string) => {
    const cur = await submissions.getPublished(bvid, cid);
    const alignment = cur ? await cache.get(cacheKey({ bvid, cid, lyricsHash: cur.lyricsHash })) : undefined;
    return { alignment: alignment ?? null, source: alignment ? (cur!.source ?? "upload") : null };
  };

  router.get("/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  router.get(
    "/me",
    requireAuth,
    wrap(async (req, res) => res.json({ mid: req.mid, isAdmin: isAdmin(req.mid) })),
  );

  // 普通用户由客户端在播放时自动发起；manual 只对管理员生效：插到队首、跳过缓存重跑一遍，用来判断问题出在哪
  router.post(
    "/align/jobs",
    requireAuth,
    limiter,
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.body?.bvid, req.body?.cid);
      if (typeof req.body?.lyrics !== "string") throw new AlignError("BAD_REQUEST", "缺少 lyrics");
      const lines = parseLyrics(req.body.lyrics);
      const origin = req.body?.manual === true && isAdmin(req.mid) ? "manual" : "auto";
      const view = await queue.submit({ mid: req.mid!, origin, bvid, cid, lyricsHash: lyricsHash(lines), lines });
      res.status(view.id ? 202 : 200).json(view);
    }),
  );

  router.get(
    "/align/jobs/:id",
    requireAuth,
    limiter,
    wrap(async (req, res) => res.json(queue.get(String(req.params.id)))),
  );

  // 用户上传自己的歌词（带不带时间都行）：服务端先排队对齐，审核员看到的是对齐后的效果
  router.post(
    "/lyrics/submissions",
    requireAuth,
    limiter,
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.body?.bvid, req.body?.cid);
      if (typeof req.body?.lyrics !== "string") throw new AlignError("BAD_REQUEST", "缺少 lyrics");
      const note = text(req.body?.note, 200);
      const lines = parseLyrics(req.body.lyrics);
      const hash = lyricsHash(lines);
      const sub = await submissions.create({
        bvid,
        cid,
        mid: req.mid!,
        lyricsHash: hash,
        lines,
        // 只用于审核列表展示；服务端不为一个标题去打 B 站接口
        title: text(req.body?.title, 100) || bvid,
        ...(note ? { note } : {}),
      });
      await queue.submit({ mid: req.mid!, origin: "upload", bvid, cid, lyricsHash: hash, lines });
      res.status(201).json(brief(sub));
    }),
  );

  router.get(
    "/lyrics/submissions/mine",
    requireAuth,
    limiter,
    wrap(async (req, res) => res.json({ items: (await submissions.list(s => s.mid === req.mid)).map(brief) })),
  );

  // 报错：用户觉得正在看的这份时间轴不对
  router.post(
    "/lyrics/reports",
    requireAuth,
    limiter,
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.body?.bvid, req.body?.cid);
      const hash = parseHash(req.body?.lyricsHash);
      const alignment = await cache.get(cacheKey({ bvid, cid, lyricsHash: hash }));
      if (!alignment) throw new AlignError("ALIGNMENT_NOT_READY");
      const cur = await submissions.getPublished(bvid, cid);
      const report = await reports.create({
        bvid,
        cid,
        mid: req.mid!,
        lyricsHash: hash,
        title: alignment.video.title,
        note: text(req.body?.note, 200),
        wasPublished: cur?.lyricsHash === hash,
      });
      res.status(201).json(report);
    }),
  );

  router.get(
    "/lyrics/reports/mine",
    requireAuth,
    limiter,
    wrap(async (req, res) => res.json({ items: await reports.list(r => r.mid === req.mid) })),
  );

  // 客户端自动识别出的歌词（未对齐）或「查无歌词」标记：谁都能读，只有登录用户能写，写入不改写已有的同版本结果。
  // 识别在客户端做（各用户自己的出口 IP 请求歌词平台），服务端只存，不替大家去请求
  router.post(
    "/lyrics/recognized",
    requireAuth,
    limiter,
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.body?.bvid, req.body?.cid);
      const v = req.body?.v;
      if (!Number.isInteger(v) || v < 1 || v > 1000) throw new AlignError("BAD_REQUEST", "v 不对");
      const base = { bvid, cid, v: v as number, by: req.mid! };
      let input: RecognizedInput;
      if (req.body?.missing === true) {
        input = { ...base, missing: true };
      } else {
        const lyrics = req.body?.lyrics;
        const from = req.body?.from as RecognizedFrom;
        if (typeof lyrics !== "string" || lyrics.length > MAX_CHARS) throw new AlignError("LYRICS_TOO_LONG");
        if (!RECOGNIZED_FROM.includes(from)) throw new AlignError("BAD_REQUEST", "from 不对");
        const tLyrics = req.body?.tLyrics;
        if (tLyrics !== undefined && (typeof tLyrics !== "string" || tLyrics.length > MAX_CHARS)) {
          throw new AlignError("BAD_REQUEST", "tLyrics 不对");
        }
        // 至少 3 行带时间的歌词才算识别成功，与客户端自动采用的门槛一致
        const timed = parseLyrics(lyrics).filter(line => line.t > 0);
        if (timed.length < 3) throw new AlignError("LYRICS_EMPTY");
        input = { ...base, lyrics, tLyrics: tLyrics || undefined, from };
      }
      res.json({ stored: await recognized.put(input) });
    }),
  );

  router.get(
    "/lyrics/:bvid/:cid/recognized",
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.params.bvid, req.params.cid);
      res.json(await recognized.get(bvid, cid));
    }),
  );

  // 必须注册在 /lyrics/submissions/mine、/lyrics/reports/mine 之后，否则会被当成 bvid/cid 吃掉。
  // 对所有人生效的版本；没有时返回 null 而不是 404，客户端每次打开歌都会查，404 会刷满错误日志
  router.get(
    "/lyrics/:bvid/:cid",
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.params.bvid, req.params.cid);
      res.json(await published(bvid, cid));
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

  // 审核详情：这次上传的对齐结果（还在排队时为 null，对不上时给 failure）+ 当前在用的版本，方便对比试听
  admin.get(
    "/submissions/:id",
    wrap(async (req, res) => {
      const sub = await submissions.get(String(req.params.id));
      const alignment = await cache.get(cacheKey(sub));
      const failure = alignment ? undefined : await failures.get(cacheKey(sub));
      const cur = await published(sub.bvid, sub.cid);
      res.json({
        submission: sub,
        alignment: alignment ?? null,
        failure: failure ? new AlignError(failure.code).toJSON() : null,
        current: cur.alignment,
        currentSource: cur.source,
      });
    }),
  );

  admin.post(
    "/submissions/:id/approve",
    wrap(async (req, res) => {
      const sub = await submissions.get(String(req.params.id));
      // 对齐还没跑完或缓存丢了（换算法版本、磁盘清理）时不能放行，否则通过后所有人拿到的是空歌词
      if (!(await cache.get(cacheKey(sub)))) throw new AlignError("ALIGNMENT_NOT_READY");
      const done = await submissions.approve(sub.id, req.mid!);
      await failures.clear(cacheKey(sub));
      res.json(brief(done));
    }),
  );

  admin.post(
    "/submissions/:id/reject",
    wrap(async (req, res) => {
      const reason = text(req.body?.reason, 200);
      if (!reason) throw new AlignError("REJECT_REASON_REQUIRED");
      res.json(brief(await submissions.reject(String(req.params.id), req.mid!, reason)));
    }),
  );

  admin.get(
    "/reports",
    wrap(async (req, res) => {
      const status = typeof req.query.status === "string" ? req.query.status : "pending";
      res.json({ items: await reports.list(r => r.status === status) });
    }),
  );

  // 被报错的那份对齐结果 + 现在在用的版本（报错之后可能已经换过）
  admin.get(
    "/reports/:id",
    wrap(async (req, res) => {
      const report = await reports.get(String(req.params.id));
      const alignment = await cache.get(cacheKey(report));
      const cur = await published(report.bvid, report.cid);
      res.json({ report, alignment: alignment ?? null, current: cur.alignment, currentSource: cur.source });
    }),
  );

  // 确认有误。withdraw = 同时下线这份：还要记一笔，否则下一位听众自动对齐又会命中缓存把它顶回来
  admin.post(
    "/reports/:id/resolve",
    wrap(async (req, res) => {
      const report = await reports.get(String(req.params.id));
      const withdraw = req.body?.withdraw === true;
      if (withdraw) {
        await submissions.unpublish(report.bvid, report.cid, report.lyricsHash);
        await failures.put(cacheKey(report), "ALIGNMENT_WITHDRAWN");
      }
      const reason = text(req.body?.reason, 200);
      const done = await reports.close(report.id, req.mid!, {
        status: "resolved",
        ...(reason ? { reason } : {}),
        ...(withdraw ? { withdrawn: true } : {}),
      });
      res.json(done satisfies Report);
    }),
  );

  admin.post(
    "/reports/:id/dismiss",
    wrap(async (req, res) => {
      const reason = text(req.body?.reason, 200);
      if (!reason) throw new AlignError("REJECT_REASON_REQUIRED");
      res.json(await reports.close(String(req.params.id), req.mid!, { status: "dismissed", reason }));
    }),
  );

  // 管理员手动对齐、预览满意后直接发布，替换当前版本；也会清掉这份歌词之前「对不上 / 已下线」的记录
  admin.post(
    "/published",
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.body?.bvid, req.body?.cid);
      if (typeof req.body?.lyrics !== "string") throw new AlignError("BAD_REQUEST", "缺少 lyrics");
      const hash = lyricsHash(parseLyrics(req.body.lyrics));
      const key = cacheKey({ bvid, cid, lyricsHash: hash });
      if (!(await cache.get(key))) throw new AlignError("ALIGNMENT_NOT_READY");
      await submissions.publish({ bvid, cid, lyricsHash: hash, source: "admin", by: req.mid! });
      await failures.clear(key);
      res.json(await published(bvid, cid));
    }),
  );

  router.use("/admin", admin);
  return router;
}
