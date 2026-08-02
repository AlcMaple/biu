import { Router } from "express";

import { applyOps, type SyncOp } from "../lib/merge.js";
import { syncRateLimiter } from "../lib/rate-limit.js";
import { type AuthedRequest, requireAuth } from "../lib/require-auth.js";
import { getEnvelope, mutateEnvelope } from "../lib/storage.js";
import { isStoreName } from "../lib/store-names.js";

function isValidOp(op: unknown): op is SyncOp {
  if (typeof op !== "object" || op === null) return false;
  const candidate = op as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.updatedAt !== "number") return false;
  return candidate.type === "upsert" || candidate.type === "remove";
}

export function createSyncRouter(): Router {
  const router = Router();

  router.use(requireAuth, syncRateLimiter);

  router.get("/sync/:store", async (req: AuthedRequest, res) => {
    const { store } = req.params;
    if (!isStoreName(store)) {
      res.status(404).json({ error: "unknown store" });
      return;
    }
    const envelope = await getEnvelope(req.mid!, store);
    res.json(envelope);
  });

  router.post("/sync/:store", async (req: AuthedRequest, res) => {
    const { store } = req.params;
    if (!isStoreName(store)) {
      res.status(404).json({ error: "unknown store" });
      return;
    }

    const { baseVersion, ops } = req.body ?? {};
    if (typeof baseVersion !== "number" || !Array.isArray(ops)) {
      res.status(400).json({ error: "baseVersion (number) and ops (array) are required" });
      return;
    }
    if (!ops.every(isValidOp)) {
      res.status(400).json({ error: "malformed op: each op needs {type, id, updatedAt, ...}" });
      return;
    }

    // 空操作数组：直接返回当前快照，不推进 version，避免空推送干扰其他
    // 设备的 baseVersion 判断
    if (ops.length === 0) {
      const envelope = await getEnvelope(req.mid!, store);
      res.json(envelope);
      return;
    }

    const result = await mutateEnvelope(req.mid!, store, current => {
      // baseVersion 落后或持平都走同一条合并路径：ops 之间按 id 相互独立
      // 时直接合并；同一 id 被两边都改过时，applyOps 内部按 updatedAt 更晚者生效。
      // 这就是"不整文件覆盖、条目级合并"的核心，不需要为
      // currentVersion === baseVersion 单独走一条"无冲突快速路径"。
      const mergedData = applyOps(current.data, ops as SyncOp[]);
      return {
        version: current.version + 1,
        updatedAt: Date.now(),
        data: mergedData,
      };
    });

    res.json(result);
  });

  return router;
}
