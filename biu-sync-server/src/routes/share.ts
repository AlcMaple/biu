import { type NextFunction, type Request, type Response, Router } from "express";
import rateLimit from "express-rate-limit";

import { syncRateLimiter } from "../lib/rate-limit.js";
import { type AuthedRequest, requireAuth } from "../lib/require-auth.js";
import { parseShareBody, publishShare, readShare, ShareRequestError } from "../lib/shares.js";

// 公开读取没有登录态，只能按来源 IP 限流，防止被拿来刷磁盘读
const publicReadLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set("Cache-Control", "no-store");
  next();
}

export function createShareRouter(): Router {
  const router = Router();
  router.use(noStore);

  router.post("/share", requireAuth, syncRateLimiter, async (req: AuthedRequest, res) => {
    try {
      const folder = await publishShare(req.mid!, parseShareBody(req.body));
      res.json({ code: folder.code, count: folder.items.length });
    } catch (err) {
      if (err instanceof ShareRequestError) {
        res.status(err.status).json({ error: err.message });
      } else {
        console.error("[share] publish failed", err);
        res.status(500).json({ error: "分享链接生成失败，请稍后重试" });
      }
    }
  });

  router.get("/share/:code", publicReadLimiter, async (req, res) => {
    try {
      const folder = await readShare(req.params.code);
      if (!folder) {
        res.status(404).json({ error: "这个分享不存在或已失效" });
        return;
      }
      const { mid: _mid, ...publicFolder } = folder;
      res.json(publicFolder);
    } catch (err) {
      console.error("[share] read failed", err);
      res.status(500).json({ error: "分享内容读取失败，请稍后重试" });
    }
  });

  return router;
}
