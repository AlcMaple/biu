import { Worker } from "node:worker_threads";

import { MediaSafetyPausedError } from "./media-safety-store.js";
import {
  isMediaSafetyWorkerReply,
  type MediaSafetyOperation,
  type MediaSafetyWorkerRequest,
} from "./media-safety-worker-protocol.js";

interface PendingOperation {
  method: MediaSafetyOperation["method"];
  resolve: (admission: string | undefined) => void;
  reject: (error: MediaSafetyPausedError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface MediaSafetyWorkerOptions {
  createWorker?: (file: string) => Worker;
  operationTimeoutMs?: number;
}

export class MediaSafetyWorkerClient {
  private worker?: Worker;
  private termination?: Promise<void>;
  private readonly pending = new Map<number, PendingOperation>();
  private readonly timeoutMs: number;
  private sequence = 0;
  private failed = false;
  private epoch = 0;
  private stopping = 0;
  private admitting = 0;

  constructor(
    private readonly file: string,
    private readonly options: MediaSafetyWorkerOptions = {},
  ) {
    // 超时只代表结果未知，不代表上游恢复；慢盘误停的成本仍需部署环境验收。
    this.timeoutMs = options.operationTimeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 300_000)
      throw new Error("invalid media safety operation timeout");
  }

  private stop() {
    this.failed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new MediaSafetyPausedError("storage"));
    }
    this.pending.clear();
    if (this.worker && !this.termination) {
      this.termination = this.worker.terminate().then(() => undefined);
      void this.termination.catch(() => console.error("[media-safety] worker termination failed"));
    }
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.options.createWorker
      ? this.options.createWorker(this.file)
      : new Worker(new URL("./media-safety-worker.js", import.meta.url), { workerData: { file: this.file } });
    this.worker = worker;
    worker.on("error", () => this.stop());
    worker.on("exit", () => this.stop());
    worker.on("message", (reply: unknown) => {
      if (this.failed) return;
      if (!isMediaSafetyWorkerReply(reply)) {
        this.stop();
        return;
      }
      const pending = this.pending.get(reply.id);
      if (!pending || (reply.ok && (pending.method === "begin") !== (reply.admission !== undefined))) {
        this.stop();
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(reply.id);
      if (this.pending.size === 0) worker.unref();
      if (reply.ok) pending.resolve(reply.admission);
      else pending.reject(new MediaSafetyPausedError(reply.reason));
    });
    return worker;
  }

  private call(operation: MediaSafetyOperation): Promise<string | undefined> {
    if (this.failed) return Promise.reject(new MediaSafetyPausedError("storage"));
    // 128个入场与128个收尾都有预算；收尾拥塞时保留未知意图，不丢弃后继续发请求。
    if (this.pending.size >= 256 || !Number.isSafeInteger(this.sequence + 1)) {
      this.stop();
      return Promise.reject(new MediaSafetyPausedError("storage"));
    }
    return new Promise((resolve, reject) => {
      try {
        const worker = this.getWorker();
        const id = ++this.sequence;
        const timer = setTimeout(() => this.stop(), this.timeoutMs);
        this.pending.set(id, { method: operation.method, resolve, reject, timer });
        worker.ref();
        const request: MediaSafetyWorkerRequest = { ...operation, id };
        worker.postMessage(request);
      } catch {
        this.stop();
        reject(new MediaSafetyPausedError("storage"));
      }
    });
  }

  async begin(): Promise<string> {
    if (this.stopping) throw new MediaSafetyPausedError("unconfirmed");
    if (this.admitting >= 128) throw new MediaSafetyPausedError("capacity");
    this.admitting++;
    const epoch = this.epoch;
    try {
      const admission = await this.call({ method: "begin" });
      if (this.failed) throw new MediaSafetyPausedError("storage");
      if (!admission) throw new MediaSafetyPausedError("storage");
      // 限制已在主线程出现时，排队落盘的旧许可也不能再用于出站。
      if (this.stopping || this.epoch !== epoch) {
        await this.call({ method: "abandon", admission });
        throw new MediaSafetyPausedError("unconfirmed");
      }
      return admission;
    } finally {
      this.admitting--;
    }
  }

  async finish(admission: string, status: number | "network", riskControl = false): Promise<void> {
    const restricted = status === 429 || (typeof status === "number" && status >= 500) || riskControl;
    if (restricted) {
      this.epoch++;
      this.stopping++;
    }
    try {
      await this.call({ method: "finish", admission, status, riskControl });
    } finally {
      if (restricted) this.stopping--;
    }
  }

  async abandon(admission: string): Promise<void> {
    this.epoch++;
    await this.call({ method: "abandon", admission });
  }

  async close(): Promise<void> {
    this.stop();
    await this.termination;
  }
}
