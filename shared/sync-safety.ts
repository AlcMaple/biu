export type SyncHoldReason = "rate_limit" | "risk_control" | "service_unavailable";

export interface SyncSafetyState {
  schema: 1;
  revision: number;
  hold: { reason: SyncHoldReason; signal: number; at: number } | null;
}

export type SyncSafetyAction =
  | { kind: "read" }
  | { kind: "hold"; signal: number; at: number }
  | { kind: "resume"; expectedRevision: number };

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

export function readSyncSafetyState(value: unknown): SyncSafetyState {
  if (value === undefined) return initialSyncSafetyState();
  if (!record(value) || value.schema !== 1 || !counter(value.revision)) {
    throw new Error("同步暂停记录损坏，请保留记录并检查设备存储");
  }
  if (value.hold === null) return { schema: 1, revision: value.revision, hold: null };
  const hold = value.hold;
  if (!record(hold) || typeof hold.signal !== "number" || !counter(hold.at)) {
    throw new Error("同步暂停记录损坏，请保留记录并检查设备存储");
  }
  const reason = syncHoldReason(hold.signal);
  if (!reason || hold.reason !== reason || value.revision === 0) {
    throw new Error("同步暂停记录损坏，请保留记录并检查设备存储");
  }
  return { schema: 1, revision: value.revision, hold: { reason, signal: hold.signal, at: hold.at } };
}

export function updateSyncSafetyState(saved: unknown, action: unknown): SyncSafetyState {
  const state = readSyncSafetyState(saved);
  if (!record(action)) throw new Error("同步暂停操作无效");
  if (action.kind === "read") return state;
  if (action.kind === "resume") {
    if (!counter(action.expectedRevision)) throw new Error("同步恢复版本无效");
    // 只确认用户实际看过的版本；另一标签刚收到的限制不能被旧恢复操作抹掉。
    if (action.expectedRevision !== state.revision || state.hold === null) return state;
  } else if (action.kind === "hold") {
    if (typeof action.signal !== "number" || !syncHoldReason(action.signal) || !counter(action.at)) {
      throw new Error("同步暂停原因无效");
    }
  } else {
    throw new Error("同步暂停操作无效");
  }
  if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error("同步暂停版本已达上限");
  return {
    schema: 1,
    revision: state.revision + 1,
    hold:
      action.kind === "hold"
        ? { reason: syncHoldReason(action.signal as number)!, signal: action.signal as number, at: action.at as number }
        : null,
  };
}
