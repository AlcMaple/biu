import { symlinkSync } from "node:fs";
// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

import { runMediaSafetyCommand } from "../web-server/media-safety-cli";
import { MediaSafetyStore } from "../web-server/media-safety-store";

let directory: string;
let file: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "biu-lock-status-"));
  file = path.join(directory, "state.json");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test("无锁的清洁记录仅返回只读状态", () => {
  new MediaSafetyStore(file);
  const before = readFileSync(file);
  expect(runMediaSafetyCommand(["status", "--file", file])).toMatchObject({
    initialized: true,
    storageLockPresent: false,
    pausedOrUnconfirmed: false,
  });
  expect(readFileSync(file)).toEqual(before);
});

test("记录无暂停但锁占用时，不显示未暂停的假象也不移除锁", () => {
  new MediaSafetyStore(file);
  mkdirSync(`${file}.lock`);
  const before = readFileSync(file);
  expect(runMediaSafetyCommand(["status", "--file", file])).toMatchObject({
    initialized: true,
    storageLockPresent: true,
    pausedOrUnconfirmed: true,
    reason: null,
  });
  expect(readFileSync(file)).toEqual(before);
  expect(existsSync(`${file}.lock`)).toBe(true);
});

test("文件尚不存在但有锁时照实报告，不创建或清理", () => {
  mkdirSync(`${file}.lock`);
  expect(runMediaSafetyCommand(["status", "--file", file])).toMatchObject({
    initialized: false,
    storageLockPresent: true,
  });
  expect(existsSync(file)).toBe(false);
  expect(existsSync(`${file}.lock`)).toBe(true);
});

test("查询锁不授予恢复权限，恢复仍拒绝占用锁且保留原件", () => {
  const store = new MediaSafetyStore(file);
  const revision = store.read().revision;
  mkdirSync(`${file}.lock`);
  const before = readFileSync(file);
  expect(() =>
    runMediaSafetyCommand(["resume", "--file", file, "--revision", String(revision), "--confirm", "resume-media"]),
  ).toThrow();
  expect(readFileSync(file)).toEqual(before);
  expect(existsSync(`${file}.lock`)).toBe(true);
});

test("损坏符号链接仍占用锁路径，查询不误报无锁", () => {
  new MediaSafetyStore(file);
  symlinkSync(path.join(directory, "missing-target"), `${file}.lock`);
  const before = readFileSync(file);
  expect(runMediaSafetyCommand(["status", "--file", file])).toMatchObject({
    storageLockPresent: true,
    pausedOrUnconfirmed: true,
  });
  expect(readFileSync(file)).toEqual(before);
});
