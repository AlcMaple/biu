import { type NextFunction, type Request, type Response, Router } from "express";
import rateLimit from "express-rate-limit";

import type { AlignmentCache, FailureCache } from "./lib/alignment-cache.js";
import type { DraftStore, InputStore } from "./lib/drafts.js";
import type { AlignQueue } from "./lib/queue.js";
import type { RecognizedStore } from "./lib/recognized.js";
import type { Report, ReportStore } from "./lib/reports.js";
import type { ScreenQueue } from "./lib/screen-queue.js";
import type { SubtitleLine } from "./lib/screen-worker.js";
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
  drafts: DraftStore;
  inputs: InputStore;
  submissions: SubmissionStore;
  reports: ReportStore;
  recognized: RecognizedStore;
  screen: ScreenQueue;
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

const MAX_SUBTITLE_LINES = 1000;

// 客户端只传字幕内容，不传字幕地址：地址带签名，不能出现在请求里（AGENTS.md「网络请求」）
const parseSubtitle = (value: unknown): SubtitleLine[] => {
  if (!Array.isArray(value) || value.length > MAX_SUBTITLE_LINES) throw new AlignError("BAD_REQUEST", "subtitle 不对");
  let chars = 0;
  const lines = value.map(item => {
    const { from, to, content } = (item ?? {}) as Record<string, unknown>;
    if (typeof from !== "number" || typeof to !== "number" || !Number.isFinite(from) || !Number.isFinite(to)) {
      throw new AlignError("BAD_REQUEST", "subtitle 时间不对");
    }
    if (typeof content !== "string" || content.length > 200) throw new AlignError("BAD_REQUEST", "subtitle 内容不对");
    chars += content.length;
    return { from, to, content };
  });
  if (chars > MAX_CHARS) throw new AlignError("LYRICS_TOO_LONG");
  return lines;
};

export function createRouter(deps: RouteDeps): Router {
  const { queue, cache, failures, drafts, inputs, submissions, reports, recognized, screen } = deps;
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

  // 审核页按报错重跑：报错只带歌词哈希，原文从对齐时留下的记录或同一份上传里找
  const inputOf = async (t: { bvid: string; cid: string; lyricsHash: string }) =>
    (await inputs.get(cacheKey(t))) ??
    (await submissions.list(s => s.bvid === t.bvid && s.cid === t.cid && s.lyricsHash === t.lyricsHash))[0]?.lines;

  // 生效版本换了，这首歌之前的报错就都有了着落：不管从审核页还是播放器里发布，都不用再回审核页逐条点「已处理」
  const closeReportsOf = async (bvid: string, cid: string, by: string, reason: string) => {
    for (const r of await reports.list(r => r.status === "pending" && r.bvid === bvid && r.cid === cid)) {
      await reports.close(r.id, by, { status: "resolved", reason });
    }
  };

  router.get("/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  router.get(
    "/me",
    requireAuth,
    wrap(async (req, res) => res.json({ mid: req.mid, isAdmin: isAdmin(req.mid) })),
  );

  // 普通用户由客户端在播放时自动发起；manual 只对管理员生效：插到队首、跳过缓存重跑一遍，用来判断问题出在哪。
  // 结果是草稿，不影响所有人在用的版本；已有草稿时直接给回草稿，force 才真的重跑
  router.post(
    "/align/jobs",
    requireAuth,
    limiter,
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.body?.bvid, req.body?.cid);
      if (typeof req.body?.lyrics !== "string") throw new AlignError("BAD_REQUEST", "缺少 lyrics");
      const lines = parseLyrics(req.body.lyrics);
      const origin = req.body?.manual === true && isAdmin(req.mid) ? "manual" : "auto";
      const view = await queue.submit({
        mid: req.mid!,
        origin,
        bvid,
        cid,
        lyricsHash: lyricsHash(lines),
        lines,
        force: origin === "manual" && req.body?.force === true,
      });
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
        if (!(RECOGNIZED_FROM as readonly string[]).includes(from)) throw new AlignError("BAD_REQUEST", "from 不对");
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

  // 填词歌：从视频画面识别歌词，用客户端拉到的 B 站 AI 字幕校对；结果写进「已识别歌词」，所有人共享。
  // 字幕内容服务端无法独立核实（它没有登录态），信任等级和客户端上报识别歌词相同：只收登录用户、记录提交者
  router.post(
    "/lyrics/screen-jobs",
    requireAuth,
    limiter,
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.body?.bvid, req.body?.cid);
      const v = req.body?.v;
      if (!Number.isInteger(v) || v < 1 || v > 1000) throw new AlignError("BAD_REQUEST", "v 不对");
      const view = await screen.submit({
        mid: req.mid!,
        bvid,
        cid,
        v: v as number,
        subtitle: parseSubtitle(req.body?.subtitle),
      });
      res.status(view.id ? 202 : 200).json(view);
    }),
  );

  router.get(
    "/lyrics/screen-jobs/:id",
    requireAuth,
    limiter,
    wrap(async (req, res) => res.json(screen.get(String(req.params.id)))),
  );

  router.get(
    "/lyrics/:bvid/:cid/recognized",
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.params.bvid, req.params.cid);
      res.json(await recognized.get(bvid, cid));
    }),
  );

  // 必须注册在 /lyrics/submissions/mine、/lyrics/reports/mine、/lyrics/screen-jobs/:id 之后，否则会被当成 bvid/cid 吃掉。
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
      await closeReportsOf(sub.bvid, sub.cid, req.mid!, "已换成审核通过的上传版本");
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

  // 被报错的那份对齐结果 + 现在在用的版本（报错之后可能已经换过）+ 同一份歌词重跑出的草稿，审核页并排对照
  admin.get(
    "/reports/:id",
    wrap(async (req, res) => {
      const report = await reports.get(String(req.params.id));
      const alignment = await cache.get(cacheKey(report));
      const cur = await published(report.bvid, report.cid);
      const draft = await drafts.get(report);
      res.json({
        report,
        alignment: alignment ?? null,
        current: cur.alignment,
        currentSource: cur.source,
        draft: draft?.alignment ?? null,
        canRealign: Boolean(await inputOf(report)),
      });
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

  admin.post(
    "/realign",
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.body?.bvid, req.body?.cid);
      const hash = parseHash(req.body?.lyricsHash);
      const lines = await inputOf({ bvid, cid, lyricsHash: hash });
      if (!lines?.length) throw new AlignError("INPUT_UNAVAILABLE");
      const view = await queue.submit({
        mid: req.mid!,
        origin: "manual",
        bvid,
        cid,
        lyricsHash: hash,
        lines,
        force: true,
      });
      res.status(view.id ? 202 : 200).json(view);
    }),
  );

  // 管理员切歌回来时恢复上次的试听：只看这首歌最近一次没发布的草稿
  admin.get(
    "/drafts/:bvid/:cid",
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.params.bvid, req.params.cid);
      const draft = await drafts.latest(bvid, cid);
      res.json({
        draft: draft ? { lyricsHash: draft.lyricsHash, alignment: draft.alignment, createdAt: draft.createdAt } : null,
      });
    }),
  );

  admin.post(
    "/drafts/discard",
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.body?.bvid, req.body?.cid);
      await drafts.delete({ bvid, cid, lyricsHash: parseHash(req.body?.lyricsHash) });
      res.json({ ok: true });
    }),
  );

  // 管理员发布：有草稿就用草稿替换当前版本（没有就用已有的对齐结果），并关掉这首歌的报错；
  // 也会清掉这份歌词之前「对不上 / 已下线」的记录。审核页没有歌词原文，可以只给 lyricsHash
  admin.post(
    "/published",
    wrap(async (req, res) => {
      const { bvid, cid } = parseTarget(req.body?.bvid, req.body?.cid);
      let hash: string;
      if (typeof req.body?.lyricsHash === "string") hash = parseHash(req.body.lyricsHash);
      else if (typeof req.body?.lyrics === "string") hash = lyricsHash(parseLyrics(req.body.lyrics));
      else throw new AlignError("BAD_REQUEST", "缺少 lyrics");
      const target = { bvid, cid, lyricsHash: hash };
      const key = cacheKey(target);
      const draft = await drafts.get(target);
      if (draft) {
        await cache.put(key, draft.alignment);
        await drafts.delete(target);
      }
      if (!(await cache.get(key))) throw new AlignError("ALIGNMENT_NOT_READY");
      await submissions.publish({ bvid, cid, lyricsHash: hash, source: "admin", by: req.mid! });
      await failures.clear(key);
      await closeReportsOf(bvid, cid, req.mid!, "已换成管理员重新对齐的版本");
      res.json(await published(bvid, cid));
    }),
  );

  router.use("/admin", admin);
  return router;
}
