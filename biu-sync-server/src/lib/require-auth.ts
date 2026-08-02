import type { NextFunction, Request, Response } from "express";

import { verifyToken } from "./auth.js";

export interface AuthedRequest extends Request {
  mid?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }

  try {
    const { mid } = verifyToken(token);
    req.mid = mid;
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
  }
}
