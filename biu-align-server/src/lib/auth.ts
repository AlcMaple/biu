import type { NextFunction, Request, Response } from "express";

import jwt from "jsonwebtoken";

import { config } from "./config.js";
import { AlignError } from "./errors.js";

export interface AuthedRequest extends Request {
  mid?: string;
}

// token 由 biu-sync-server 的 /api/auth/exchange 签发（那边用 B 站 cookie 调官方 nav 接口验证过 mid），这里只验签
export function verifyToken(token: string): string {
  const decoded = jwt.verify(token, config.jwtSecret);
  const mid = typeof decoded === "object" && decoded !== null ? (decoded as { mid?: unknown }).mid : undefined;
  if (typeof mid !== "string" || !mid) throw new Error("malformed token payload");
  return mid;
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) return next(new AlignError("UNAUTHORIZED"));
  try {
    req.mid = verifyToken(token);
    next();
  } catch {
    next(new AlignError("UNAUTHORIZED"));
  }
}

export const isAdmin = (mid: string | undefined) => Boolean(mid && config.adminMids.has(mid));

export function requireAdmin(req: AuthedRequest, _res: Response, next: NextFunction): void {
  next(isAdmin(req.mid) ? undefined : new AlignError("FORBIDDEN"));
}
