import type { SyncSafetyAction, SyncSafetyState } from "@shared/sync-safety";

export class SyncPausedError extends Error {
  readonly code = "BIU_SYNC_PAUSED";
}

export const isSyncPausedError = (error: unknown): error is SyncPausedError =>
  error instanceof SyncPausedError || (error as { code?: string })?.code === "BIU_SYNC_PAUSED";

export interface SyncSafetyView {
  state?: SyncSafetyState;
  abandonedIds: string[];
  error?: string;
}

export interface SyncContext {
  owner: string;
  liveOwners: () => Promise<Set<string>>;
  retire: () => Promise<void>;
}

type Storage = (action: SyncSafetyAction) => Promise<SyncSafetyState>;

export function createSyncSafetyGate(
  storage: Storage,
  context: () => Promise<SyncContext>,
  changed: (view: SyncSafetyView) => void,
) {
  const failed = new Set<string>();
  let latched: string | undefined;
  let failureRevision = Number.MAX_SAFE_INTEGER;
  let view: SyncSafetyView = { abandonedIds: [] };
  const publish = (next: SyncSafetyView) => {
    view = next;
    changed(next);
    return next;
  };
  const failure = async (error?: unknown) => {
    const message = isSyncPausedError(error) ? error.message : "同步保护记录读写失败，自动同步已暂停";
    failureRevision = view.state?.revision ?? Number.MAX_SAFE_INTEGER;
    latched = message;
    publish({ ...view, error: message });
    try {
      await (await context()).retire();
    } catch {
      // 注册本身失败时没有活动锁；此前的错误已经保留在可见状态里。
    }
    return new SyncPausedError(message);
  };
  async function inspect(state: SyncSafetyState) {
    const owners = await (await context()).liveOwners();
    // 页面查询返回顺序不保证一致，迟到的旧快照不能覆盖已看见的新暂停。
    if (view.state && state.revision < view.state.revision) state = view.state;
    // 另一页面的明确确认可解除本地锁定；普通成功响应或时间经过不能冒充人工恢复。
    if (latched && (state.resumedAtRevision ?? 0) > failureRevision) latched = undefined;
    const abandonedIds = Object.entries(state.pending ?? {})
      .filter(([id, entry]) => failed.has(id) || !owners.has(entry.owner))
      .map(([id]) => id);
    return publish({ state, abandonedIds, ...(latched ? { error: latched } : {}) });
  }
  async function read() {
    try {
      return await inspect(await storage({ kind: "read" }));
    } catch (error) {
      throw await failure(error);
    }
  }
  const assertReady = (next: SyncSafetyView) => {
    if (latched || next.state?.hold || next.abandonedIds.length) throw new SyncPausedError("同步已暂停，请确认后恢复");
  };
  return {
    read,
    async abandon(id: string) {
      failed.add(id);
      throw await failure(new SyncPausedError("同步响应未确认，自动同步已暂停"));
    },
    async begin(id: string) {
      if (latched) throw new SyncPausedError(latched);
      const current = await read();
      assertReady(current);
      try {
        const { owner } = await context();
        const saved = await storage({ kind: "begin", id, owner, at: Date.now() });
        const next = await inspect(saved);
        assertReady(next);
        if (!next.state?.pending?.[id]) throw new SyncPausedError("同步已暂停，请确认后恢复");
      } catch (error) {
        failed.add(id);
        if (isSyncPausedError(error)) throw error;
        throw await failure();
      }
    },
    async finish(id: string, signal?: number) {
      try {
        const saved = await storage({ kind: "finish", id, signal, at: Date.now() });
        failed.delete(id);
        const next = await inspect(saved);
        assertReady(next);
      } catch (error) {
        if (isSyncPausedError(error)) throw error;
        // 出站前的意图仍在盘上；刷新后旧页面锁释放，它会成为待人工确认的遗留请求。
        failed.add(id);
        throw await failure();
      }
    },
    async resume(expectedRevision: number) {
      const current = await read();
      if (!current.state || current.state.revision !== expectedRevision) return false;
      try {
        const saved = await storage({ kind: "resume", expectedRevision, abandonedIds: current.abandonedIds });
        if (saved.revision !== expectedRevision + 1 || saved.resumedAtRevision !== saved.revision) {
          await inspect(saved);
          return false;
        }
        const priorLatch = latched;
        latched = undefined;
        const next = await inspect(saved);
        if (next.state?.hold || next.abandonedIds.length) {
          latched = priorLatch;
          return false;
        }
        failed.clear();
        return true;
      } catch {
        throw await failure();
      }
    },
  };
}
