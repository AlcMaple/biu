export type SyncHoldReason = "rate_limit" | "risk_control" | "service_unavailable";

export interface SyncSafetyState {
  schema: 1;
  revision: number;
  resumedAtRevision?: number;
  hold: { reason: SyncHoldReason; signal: number; at: number } | null;
  pending?: Record<string, { owner: string; at: number }>;
}

export type SyncSafetyAction =
  | { kind: "read" }
  | { kind: "hold"; signal: number; at: number }
  | { kind: "resume"; expectedRevision: number; abandonedIds?: string[] }
  | { kind: "begin"; id: string; owner: string; at: number }
  | { kind: "finish"; id: string; signal?: number; at: number };

export const initialSyncSafetyState = (): SyncSafetyState => ({ schema: 1, revision: 0, hold: null });

export function syncHoldReason(signal: number): SyncHoldReason | undefined {
  if (signal === 429) return "rate_limit";
  if ([403, 412, 418, -412, -509, -352].includes(signal)) return "risk_control";
  if (Number.isInteger(signal) && signal >= 500 && signal <= 599) return "service_unavailable";
  return undefined;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const counter = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(value);

export function readSyncSafetyState(value: unknown): SyncSafetyState {
  if (value === undefined) return initialSyncSafetyState();
  if (!record(value) || value.schema !== 1 || !counter(value.revision)) {
    throw new Error("同步暂停记录损坏，请保留记录并检查设备存储");
  }
  const state: SyncSafetyState = { schema: 1, revision: value.revision, hold: null };
  if (value.hold !== null) {
    const hold = value.hold;
    if (!record(hold) || typeof hold.signal !== "number" || !counter(hold.at)) {
      throw new Error("同步暂停记录损坏，请保留记录并检查设备存储");
    }
    const reason = syncHoldReason(hold.signal);
    if (!reason || hold.reason !== reason || value.revision === 0) {
      throw new Error("同步暂停记录损坏，请保留记录并检查设备存储");
    }
    state.hold = { reason, signal: hold.signal, at: hold.at };
  }
  if (value.resumedAtRevision !== undefined) {
    if (!counter(value.resumedAtRevision) || value.resumedAtRevision > value.revision)
      throw new Error("同步恢复记录损坏");
    state.resumedAtRevision = value.resumedAtRevision;
  }
  if (value.pending !== undefined) {
    if (!record(value.pending) || Object.keys(value.pending).length > 64) throw new Error("同步请求记录损坏");
    const pending: NonNullable<SyncSafetyState["pending"]> = {};
    for (const [id, entry] of Object.entries(value.pending)) {
      if (!identifier(id) || !record(entry) || !identifier(entry.owner) || !counter(entry.at)) {
        throw new Error("同步请求记录损坏");
      }
      pending[id] = { owner: entry.owner, at: entry.at };
    }
    if (Object.keys(pending).length) state.pending = pending;
  }
  return state;
}

export function updateSyncSafetyState(saved: unknown, action: unknown): SyncSafetyState {
  const state = readSyncSafetyState(saved);
  if (!record(action)) throw new Error("同步暂停操作无效");
  if (action.kind === "read") return state;
  const pending = { ...state.pending };
  let hold = state.hold;
  if (action.kind === "resume") {
    if (!counter(action.expectedRevision)) throw new Error("同步恢复版本无效");
    const abandoned = action.abandonedIds ?? [];
    if (!Array.isArray(abandoned) || abandoned.length > 64 || !abandoned.every(identifier)) {
      throw new Error("同步恢复请求无效");
    }
    // 只确认实际看过的版本，且只清除已失去活动页面的请求，不擦除仍在途的请求。
    if (action.expectedRevision !== state.revision) return state;
    for (const id of abandoned) delete pending[id];
    hold = null;
  } else if (action.kind === "begin") {
    if (!identifier(action.id) || !identifier(action.owner) || !counter(action.at)) throw new Error("同步请求标识无效");
    if (hold !== null) return state;
    if (pending[action.id] || Object.keys(pending).length >= 64) throw new Error("同步待确认请求过多，已停止发送");
    pending[action.id] = { owner: action.owner, at: action.at };
  } else if (action.kind === "hold" || action.kind === "finish") {
    if (!counter(action.at)) throw new Error("同步暂停时间无效");
    if (action.kind === "finish") {
      if (!identifier(action.id)) throw new Error("同步请求标识无效");
      if (!pending[action.id] && action.signal === undefined) return state;
      delete pending[action.id];
    }
    if (action.kind === "hold" || action.signal !== undefined) {
      if (typeof action.signal !== "number") throw new Error("同步暂停原因无效");
      const reason = syncHoldReason(action.signal);
      if (!reason) throw new Error("同步暂停原因无效");
      hold = { reason, signal: action.signal, at: action.at };
    }
  } else {
    throw new Error("同步暂停操作无效");
  }
  if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error("同步暂停版本已达上限");
  return {
    schema: 1,
    revision: state.revision + 1,
    hold,
    ...(action.kind === "resume"
      ? { resumedAtRevision: state.revision + 1 }
      : state.resumedAtRevision !== undefined
        ? { resumedAtRevision: state.resumedAtRevision }
        : {}),
    ...(Object.keys(pending).length ? { pending } : {}),
  };
}
