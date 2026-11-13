import type { MediaSafetyRecord } from "./media-safety-store.js";

export type MediaSafetyFailure = MediaSafetyRecord["reason"] | "unconfirmed" | "storage" | "capacity";
export type MediaSafetyOperation =
  | { method: "begin" }
  | { method: "finish"; admission: string; status: number | "network"; riskControl: boolean }
  | { method: "abandon"; admission: string };
export type MediaSafetyWorkerRequest = MediaSafetyOperation & { id: number };
export type MediaSafetyWorkerReply =
  | { id: number; ok: true; admission?: string }
  | { id: number; ok: false; reason: Exclude<MediaSafetyFailure, null> };

export const isMediaAdmission = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);

export function isMediaSafetyWorkerRequest(value: unknown): value is MediaSafetyWorkerRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<MediaSafetyWorkerRequest>;
  if (!Number.isSafeInteger(request.id) || request.id! < 1) return false;
  if (request.method === "begin") return true;
  if (request.method === "abandon") return isMediaAdmission(request.admission);
  return (
    request.method === "finish" &&
    isMediaAdmission(request.admission) &&
    (request.status === "network" ||
      (typeof request.status === "number" &&
        Number.isInteger(request.status) &&
        request.status >= 100 &&
        request.status <= 599)) &&
    typeof request.riskControl === "boolean"
  );
}

export function isMediaSafetyWorkerReply(value: unknown): value is MediaSafetyWorkerReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as Partial<MediaSafetyWorkerReply>;
  if (!Number.isSafeInteger(reply.id) || reply.id! < 1) return false;
  if (reply.ok === true) return reply.admission === undefined || isMediaAdmission(reply.admission);
  return (
    reply.ok === false &&
    ["rate-limit", "upstream-error", "risk-control", "unconfirmed", "storage", "capacity"].includes(reply.reason!)
  );
}
