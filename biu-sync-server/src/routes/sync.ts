import { type NextFunction, type Request, type Response, Router } from "express";

import { waitForChange } from "../lib/events.js";
import { applyOps, type SyncOp } from "../lib/merge.js";
import { syncRateLimiter } from "../lib/rate-limit.js";
import { type AuthedRequest, requireAuth } from "../lib/require-auth.js";
import { getEnvelope, getVersions, mutateEnvelope } from "../lib/storage.js";
import { isStoreName } from "../lib/store-names.js";

/**
 * 少于这个条目数时不启用全量删除闸门——用户手上只有一两条时把它们删掉是完全正常的
 * 操作，拦下来只会让人莫名其妙同步不了。真正要防的是"几十上百条一次性归零"。
 */
const WIPE_GUARD_MIN_ENTRIES = 5;

/**
 * 长轮询挂起上限。挂得越久，空闲时的请求数越少（50s 时每设备约 1.2 次/分钟，25s 时翻倍）；
 * 上限受反代空闲超时约束——本机 Apache `Timeout 300`，50s 有充足余量。
 * 让服务端主动收尾而不是被中间层掐断（被掐断客户端会当成网络错误退避重连）。
 */
const WATCH_TIMEOUT_MS = 50_000;

function isValidOp(op: unknown): op is SyncOp {
  if (typeof op !== "object" || op === null) return false;
  const candidate = op as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.updatedAt !== "number") return false;
  return candidate.type === "upsert" || candidate.type === "remove";
}

/**
 * 同步接口一律不可缓存。
 *
 * Why: Express 的 res.json() 默认带 ETag，Chromium 会把 GET 当可缓存资源，
 * 下次带 If-None-Match 来重新验证，服务端回 304 + 空 body（真实事故：日志里
 * 长轮询全是 304，客户端拿到的是缓存副本而不是这次的真实结果）。
 */
function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set("Cache-Control", "no-store");
  next();
}

export function createSyncRouter(): Router {
  const router = Router();
  router.use(noStore);

  router.use(requireAuth);

  // 通知通道不计入限流：它是跨设备实时的唯一来源，一旦被 429 拒掉，另一台设备的改动
  // 就彻底收不到了。而且它本身就是低频的（挂起 25s 才回一次），不是需要限流的对象。
  // 真正要防的是同步接口被异常客户端刷爆，所以限流只加在 /sync 上。
  router.get("/watch", noStore, watchHandler);
  router.use(syncRateLimiter);

  /**
   * 长轮询：客户端带上自己已知的各 store 版本号，服务端在版本发生变化时立刻返回，
   * 否则挂起到 WATCH_TIMEOUT_MS 再返回（客户端随即发起下一轮）。
   *
   * 这是"另一台设备一改就看到"的实现方式。空闲时不消耗 CPU（挂在事件总线上，不轮询），
   * 每个客户端只占一个连接；改动发生时由 notifyChange 即时唤醒，端到端延迟约等于一次
   * 请求往返。注意：Apache 反代的 ProxyTimeout 必须大于 WATCH_TIMEOUT_MS。
   */
  async function watchHandler(req: AuthedRequest, res: Response): Promise<void> {
    const known = typeof req.query.versions === "string" ? req.query.versions : "";
    const knownMap = Object.fromEntries(
      known
        .split(",")
        .filter(Boolean)
        .map(pair => {
          const [store, version] = pair.split(":");
          return [store, Number(version)];
        }),
    );

    const differs = (current: Record<string, number>) =>
      Object.entries(current).some(([store, version]) => knownMap[store] !== version);

    const current = await getVersions(req.mid!);
    if (differs(current)) {
      res.json({ changed: true, versions: current });
      return;
    }

    // 客户端断开（关窗口/切网络）时立刻释放等待，不留悬挂的监听器
    let aborted = false;
    req.on("close", () => {
      aborted = true;
    });

    await waitForChange(req.mid!, WATCH_TIMEOUT_MS);
    if (aborted) return;

    const latest = await getVersions(req.mid!);
    res.json({ changed: differs(latest), versions: latest });
  }

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

    // 全量删除闸门：一批操作把当前所有活条目删光（且没有任何新增）时拒绝执行。
    // 服务端不能假设客户端永远正确——客户端在状态未就绪时把整个歌单 diff 成全量
    // 删除，已经真实发生过一次，而墓碑会连 payload 一起丢弃，云端不可逆。
    //
    // 但用户**真的**删光是合法操作（比如只有一个歌单、里面 200 首歌，整个删掉），
    // 拦下来会让这台设备之后每次同步都被拒、彻底卡死。客户端能区分两者：真删是
    // 「本次会话里先见过内容、现在没了」，故障是「一上来就是空的」。前者会带
    // allowFullDelete=true，服务端认这个确认，只挡没有确认的。
    const current = await getEnvelope(req.mid!, store);
    const liveIds = new Set(
      Object.entries(current.data)
        .filter(([, entry]) => !entry.__deleted)
        .map(([id]) => id),
    );
    const typedOps = ops as SyncOp[];
    const removedLive = typedOps.filter(op => op.type === "remove" && liveIds.has(op.id));
    const hasUpsert = typedOps.some(op => op.type === "upsert");
    if (
      req.body?.allowFullDelete !== true &&
      liveIds.size >= WIPE_GUARD_MIN_ENTRIES &&
      !hasUpsert &&
      removedLive.length === liveIds.size
    ) {
      console.error(`[sync] 拒绝全量删除 mid=${req.mid} store=${store}：一次性删除全部 ${liveIds.size} 条活条目`);
      res.status(409).json({ error: "refused: this batch would delete every live entry", code: "wipe_guard" });
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
