import cors from "cors";
import express, { type Express } from "express";

import { errorHandler } from "./lib/errors.js";
import { createRouter, type RouteDeps } from "./routes.js";

export function createApp(deps: RouteDeps & { corsOrigin?: string }): Express {
  const app = express();
  app.disable("x-powered-by");
  // Express 默认给 JSON 带 ETag，浏览器下次带 If-None-Match 会拿到 304 空 body——轮询任务状态时等于看不到新进度
  app.set("etag", false);
  app.use(cors({ origin: deps.corsOrigin ?? true, credentials: false }));
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", createRouter(deps));
  app.use(errorHandler);
  return app;
}
