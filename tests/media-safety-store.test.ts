import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, rmdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { MediaSafetyPausedError, MediaSafetyStore } from "../web-server/media-safety-store";

let directory: string;
let file: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "biu-media-safety-"));
  file = path.join(directory, "safety.json");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("严格媒体停手账本", () => {
  test.each([429, 500, 503, 599])("HTTP %s暂停跨实例保留，旧确认不恢复", status => {
    const first = new MediaSafetyStore(file);
    const id = first.begin();
    const before = first.read().revision;
    expect(() => first.finish(id, status)).toThrow(MediaSafetyPausedError);
    const restarted = new MediaSafetyStore(file);
    expect(() => restarted.begin()).toThrow(MediaSafetyPausedError);
    expect(() => restarted.resume(before)).toThrow("changed");
    restarted.resume(restarted.read().revision);
    expect(restarted.begin()).toBeTruthy();
  });

  test.each([206, 403, 404, 412, 416, "network"] as const)("%s本身不误判限制", status => {
    const store = new MediaSafetyStore(file);
    store.finish(store.begin(), status);
    expect(store.read().reason).toBeNull();
    expect(new MediaSafetyStore(file).begin()).toBeTruthy();
  });

  test("明确风控信号可暂停，裸403不直接猜原因", () => {
    const store = new MediaSafetyStore(file);
    expect(() => store.finish(store.begin(), 403, true)).toThrow(MediaSafetyPausedError);
    expect(store.read().reason).toBe("risk-control");
  });

  test("同实例并发可入场，重启不把在途请求当成功", () => {
    const store = new MediaSafetyStore(file);
    const a = store.begin();
    const b = store.begin();
    expect(store.read().pending).toHaveLength(2);
    expect(() => new MediaSafetyStore(file).begin()).toThrow(MediaSafetyPausedError);
    store.finish(a, 206);
    store.finish(b, 206);
    expect(store.read().pending).toHaveLength(0);
  });

  test("写入锁冲突时不授权出站，既有文件不变", () => {
    const store = new MediaSafetyStore(file);
    const bytes = readFileSync(file);
    mkdirSync(`${file}.lock`);
    expect(() => store.begin()).toThrow(MediaSafetyPausedError);
    expect(readFileSync(file)).toEqual(bytes);
    rmdirSync(`${file}.lock`);
    expect(() => store.begin()).toThrow(MediaSafetyPausedError);
    store.resume(store.read().revision);
    expect(store.begin()).toBeTruthy();
  });

  test("暂停写失败后原出站意图仍在，新实例仍停", () => {
    const store = new MediaSafetyStore(file);
    const id = store.begin();
    mkdirSync(`${file}.lock`);
    expect(() => store.finish(id, 429)).toThrow(MediaSafetyPausedError);
    rmdirSync(`${file}.lock`);
    const restarted = new MediaSafetyStore(file);
    expect(restarted.read().pending).toHaveLength(1);
    expect(() => restarted.begin()).toThrow(MediaSafetyPausedError);
  });

  test("恢复写失败不清暂停记录", () => {
    const store = new MediaSafetyStore(file);
    expect(() => store.finish(store.begin(), 503)).toThrow(MediaSafetyPausedError);
    const record = store.read();
    const bytes = readFileSync(file);
    mkdirSync(`${file}.lock`);
    expect(() => store.resume(record.revision)).toThrow();
    rmdirSync(`${file}.lock`);
    expect(readFileSync(file)).toEqual(bytes);
    expect(() => store.begin()).toThrow(MediaSafetyPausedError);
  });

  test("人工恢复后迟到旧429再次暂停，旧成功不清限制", () => {
    const store = new MediaSafetyStore(file);
    const limited = store.begin();
    const success = store.begin();
    store.resume(store.read().revision);
    expect(() => store.finish(limited, 429)).toThrow(MediaSafetyPausedError);
    store.finish(success, 206);
    expect(store.read().reason).toBe("rate-limit");
  });

  test.each(["broken", "{}", '{"version":1,"revision":0,"reason":null,"pending":["bad"]}'])(
    "坏记录拒绝且原字节保留 %s",
    bytes => {
      writeFileSync(file, bytes);
      expect(() => new MediaSafetyStore(file)).toThrow();
      expect(readFileSync(file, "utf8")).toBe(bytes);
    },
  );
});

test("暂停原子写入故障保留出站意图，重开继续停手", () => {
  const store = new MediaSafetyStore(file);
  const id = store.begin();
  const before = readFileSync(file);
  const writer = vi.spyOn(store as unknown as { write: (record: unknown) => void }, "write");
  writer.mockImplementationOnce(() => {
    throw new Error("injected atomic write failure");
  });
  expect(() => store.finish(id, 429)).toThrow(MediaSafetyPausedError);
  expect(readFileSync(file)).toEqual(before);
  writer.mockRestore();
  expect(() => new MediaSafetyStore(file).begin()).toThrow(MediaSafetyPausedError);
});

test("意图写入故障不返回发送许可", () => {
  const store = new MediaSafetyStore(file);
  const before = readFileSync(file);
  vi.spyOn(store as unknown as { write: (record: unknown) => void }, "write").mockImplementationOnce(() => {
    throw new Error("injected atomic write failure");
  });
  expect(() => store.begin()).toThrow(MediaSafetyPausedError);
  expect(readFileSync(file)).toEqual(before);
  expect(store.read().pending).toEqual([]);
});

test("未确认响应撤销本进程存活标记并推进版本", () => {
  const store = new MediaSafetyStore(file);
  const id = store.begin();
  const revision = store.read().revision;
  store.abandon(id);
  expect(() => store.begin()).toThrow(MediaSafetyPausedError);
  expect(() => store.resume(revision)).toThrow("changed");
  expect(store.read().pending).toContain(id);
});

test("旧请求在人工恢复后才给出未知结果仍重新停手", () => {
  const store = new MediaSafetyStore(file);
  const id = store.begin();
  store.resume(store.read().revision);
  store.abandon(id);
  expect(() => store.begin()).toThrow(MediaSafetyPausedError);
  expect(new MediaSafetyStore(file).read().pending).toContain(id);
});
