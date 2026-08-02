import { Router } from "express";

import { InvalidCookieError, resolveMidFromCookie, signToken } from "../lib/auth.js";

export function createAuthRouter(): Router {
  const router = Router();

  router.post("/auth/exchange", async (req, res) => {
    const cookie = req.body?.cookie;
    if (typeof cookie !== "string" || !cookie.trim()) {
      res.status(400).json({ error: "missing cookie" });
      return;
    }

    try {
      const mid = await resolveMidFromCookie(cookie);
      const token = signToken(mid);
      res.json({ token, mid });
    } catch (err) {
      if (err instanceof InvalidCookieError) {
        res.status(401).json({ error: err.message });
        return;
      }
      console.error("[auth/exchange] failed", err);
      res.status(502).json({ error: "failed to verify cookie with bilibili" });
    }
  });

  return router;
}
