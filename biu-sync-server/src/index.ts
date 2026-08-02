/**
 * Biu 本地歌单云同步服务端入口。
 *
 * 部署要求（见 docs/ideas/004-本地歌单云同步.md）：
 *   - pm2 fork 模式单实例，禁止 cluster —— storage.ts 里的每 mid 互斥队列
 *     只在单进程内有效，多进程会导致并发写入互相覆盖
 *   - 只监听 127.0.0.1，由 Apache 反代到公网
 */
import cors from "cors";
import express from "express";

import { scheduleTombstoneCleanup } from "./lib/cleanup.js";
import { config } from "./lib/config.js";
import { createAuthRouter } from "./routes/auth.js";
import { createSyncRouter } from "./routes/sync.js";

const app = express();

app.use(
  cors({
    origin: config.corsOrigin ?? true,
    credentials: false,
  }),
);

// 限制请求体大小：同步 payload 是用户的歌单增量，正常情况下很小，
// 限制上限防止异常客户端一次推一个超大 payload 占满内存
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use("/api", createAuthRouter());
app.use("/api", createSyncRouter());

scheduleTombstoneCleanup();

app.listen(config.port, "127.0.0.1", () => {
  console.log(`[biu-sync-server] listening on http://127.0.0.1:${config.port}`);
});
