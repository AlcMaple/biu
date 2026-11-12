import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export interface MediaSafetyRecord {
  version: 1;
  revision: number;
  reason: "rate-limit" | "upstream-error" | "risk-control" | null;
  pending: string[];
}

const emptyRecord = (): MediaSafetyRecord => ({ version: 1, revision: 0, reason: null, pending: [] });
const reasons = new Set<unknown>([null, "rate-limit", "upstream-error", "risk-control"]);
const MAX_PENDING = 128;

function parseRecord(text: string): MediaSafetyRecord {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("invalid media safety record");
  const record = value as Partial<MediaSafetyRecord>;
  if (
    record.version !== 1 ||
    !Number.isSafeInteger(record.revision) ||
    record.revision! < 0 ||
    !reasons.has(record.reason) ||
    !Array.isArray(record.pending) ||
    record.pending.length > MAX_PENDING ||
    !record.pending.every(id => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)) ||
    new Set(record.pending).size !== record.pending.length
  )
    throw new Error("invalid media safety record");
  return { version: 1, revision: record.revision!, reason: record.reason!, pending: [...record.pending] };
}

function removeTemporary(file: string) {
  try {
    unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export class MediaSafetyPausedError extends Error {
  constructor(readonly reason: MediaSafetyRecord["reason"] | "unconfirmed" | "storage" | "capacity") {
    super("media requests are paused");
  }
}

export class MediaSafetyStore {
  private readonly active = new Set<string>();
  private failed = false;

  constructor(private readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.transaction(record => record, true);
  }

  private transaction<T>(operation: (record: MediaSafetyRecord) => T, initialize = false): T {
    const lock = `${this.file}.lock`;
    mkdirSync(lock, { mode: 0o700 });
    try {
      let record: MediaSafetyRecord;
      let created = false;
      try {
        record = parseRecord(readFileSync(this.file, "utf8"));
      } catch (error) {
        if (!initialize || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        record = emptyRecord();
        created = true;
      }
      const before = JSON.stringify(record);
      const result = operation(record);
      if (created || JSON.stringify(record) !== before) this.write(record);
      return result;
    } finally {
      rmdirSync(lock);
    }
  }

  private write(record: MediaSafetyRecord) {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify(record));
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, this.file);
      const directory = openSync(path.dirname(this.file), "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      removeTemporary(temporary);
    }
  }

  read(): MediaSafetyRecord {
    return this.transaction(record => structuredClone(record));
  }

  begin(): string {
    if (this.failed) throw new MediaSafetyPausedError("storage");
    const id = randomUUID();
    try {
      this.transaction(record => {
        if (record.reason) throw new MediaSafetyPausedError(record.reason);
        // 崩溃后遗留的请求结果未知；时间过去不是解除限制的证据。
        if (record.pending.some(pending => !this.active.has(pending))) throw new MediaSafetyPausedError("unconfirmed");
        if (record.pending.length >= MAX_PENDING) throw new MediaSafetyPausedError("capacity");
        record.revision += 1;
        if (!Number.isSafeInteger(record.revision)) throw new Error("media safety revision exhausted");
        record.pending.push(id);
      });
      this.active.add(id);
      return id;
    } catch (error) {
      if (error instanceof MediaSafetyPausedError) throw error;
      this.failed = true;
      throw new MediaSafetyPausedError("storage");
    }
  }

  finish(id: string, status: number | "network", riskControl = false): void {
    if (!this.active.has(id)) throw new MediaSafetyPausedError("unconfirmed");
    const reason =
      status === 429
        ? "rate-limit"
        : typeof status === "number" && status >= 500 && status <= 599
          ? "upstream-error"
          : riskControl
            ? "risk-control"
            : null;
    try {
      this.transaction(record => {
        record.pending = record.pending.filter(pending => pending !== id);
        // 旧请求迟到的限制仍是新事实，不能被先前的一次人工恢复吞掉。
        if (reason) record.reason = reason;
        record.revision += 1;
        if (!Number.isSafeInteger(record.revision)) throw new Error("media safety revision exhausted");
      });
    } catch {
      this.failed = true;
      throw new MediaSafetyPausedError("storage");
    } finally {
      this.active.delete(id);
    }
    if (reason) throw new MediaSafetyPausedError(reason);
  }

  resume(expectedRevision: number): MediaSafetyRecord {
    const result = this.transaction(record => {
      if (record.revision !== expectedRevision) throw new Error("media pause changed; inspect the latest record");
      record.revision += 1;
      if (!Number.isSafeInteger(record.revision)) throw new Error("media safety revision exhausted");
      record.reason = null;
      record.pending = [];
      return structuredClone(record);
    });
    this.failed = false;
    return result;
  }
}
