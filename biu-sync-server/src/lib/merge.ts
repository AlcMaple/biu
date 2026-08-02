/**
 * 条目级合并逻辑：客户端把本地变更表示为一串 { upsert | remove } 操作，
 * 服务端把它们应用到当前快照上，而不是用整份新数据覆盖旧数据。
 *
 * 删除用墓碑（{ __deleted: true, deletedAt }）表示，不物理删除条目——
 * 这样"设备 A 删除、设备 B 稍晚新增同一 id"的竞态才有明确的先后判定依据
 * （谁的时间戳更晚谁生效），而不是取决于两个请求谁先到服务器。
 */

export interface UpsertOp {
  type: "upsert";
  id: string;
  payload: unknown;
  /** 客户端本地这次编辑发生的时间，用于跨设备冲突时判定先后 */
  updatedAt: number;
}

export interface RemoveOp {
  type: "remove";
  id: string;
  updatedAt: number;
}

export type SyncOp = UpsertOp | RemoveOp;

interface LiveEntry {
  __deleted?: false;
  updatedAt: number;
  payload: unknown;
}

interface TombstoneEntry {
  __deleted: true;
  updatedAt: number;
}

export type StoreEntry = LiveEntry | TombstoneEntry;

export type StoreData = Record<string, StoreEntry>;

/**
 * 把一批操作应用到当前数据上，同一 id 的多次操作按 updatedAt 更晚者生效。
 * 不修改入参，返回新对象。
 */
export function applyOps(current: StoreData, ops: SyncOp[]): StoreData {
  const next: StoreData = { ...current };

  for (const op of ops) {
    const existing = next[op.id];
    // 已有记录且比这次操作更晚 → 这次操作是"迟到的旧数据"，丢弃
    if (existing && existing.updatedAt > op.updatedAt) {
      continue;
    }

    if (op.type === "remove") {
      next[op.id] = { __deleted: true, updatedAt: op.updatedAt };
    } else {
      next[op.id] = { updatedAt: op.updatedAt, payload: op.payload };
    }
  }

  return next;
}

/** 清理超过保留期的墓碑，物理移除记录，避免文件无限增长 */
export function pruneTombstones(data: StoreData, retentionMs: number, now: number): StoreData {
  const next: StoreData = {};
  for (const [id, entry] of Object.entries(data)) {
    if (entry.__deleted && now - entry.updatedAt > retentionMs) {
      continue;
    }
    next[id] = entry;
  }
  return next;
}
