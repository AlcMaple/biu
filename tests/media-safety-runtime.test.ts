import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { runMediaSafetyCommand } from "../web-server/media-safety-cli";
import { createPersistentMediaSafetyGate, resolveMediaSafetyFile } from "../web-server/media-safety-runtime";
import { MediaSafetyStore } from "../web-server/media-safety-store";

let directory: string;
let file: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "biu-media-runtime-"));
  file = path.join(directory, "safety.json");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("媒体运行配置与本机恢复", () => {
  test("生产默认路径与发布目录解耦，开发按工作区隔离", () => {
    expect(resolveMediaSafetyFile("production", {}, "/release-a", "/home/test")).toBe(
      resolveMediaSafetyFile("production", {}, "/release-b", "/home/test"),
    );
    expect(resolveMediaSafetyFile("development", {}, "/checkout-a", "/home/test")).not.toBe(
      resolveMediaSafetyFile("development", {}, "/checkout-b", "/home/test"),
    );
    expect(resolveMediaSafetyFile("development", { BIU_WEB_MEDIA_SAFETY_FILE: file })).toBe(file);
  });
  test.each(["", "memory", "   "])("配置 %s 不隐式关闭持久化", value => {
    expect(() => resolveMediaSafetyFile("production", { BIU_WEB_MEDIA_SAFETY_FILE: value })).toThrow();
  });
  test("初始化惰性，status不会创建不存在的账本", () => {
    createPersistentMediaSafetyGate(file);
    expect(existsSync(file)).toBe(false);
    expect(runMediaSafetyCommand(["status", "--file", file])).toEqual({
      file,
      initialized: false,
      storageLockPresent: false,
    });
    expect(existsSync(file)).toBe(false);
  });
  test("旧确认和缺少明确确认均拒绝；本机恢复后活跃服务继续使用", () => {
    const gate = createPersistentMediaSafetyGate(file);
    expect(() => gate.finish(gate.begin(), 429)).toThrow();
    const status = runMediaSafetyCommand(["status", "--file", file]);
    if (!status.initialized) throw new Error("fixture was not initialized");
    const before = readFileSync(file);
    expect(() => runMediaSafetyCommand(["resume", "--file", file, "--revision", String(status.revision)])).toThrow(
      "confirm",
    );
    expect(() =>
      runMediaSafetyCommand(["resume", "--file", file, "--revision", "0", "--confirm", "resume-media"]),
    ).toThrow("changed");
    expect(readFileSync(file)).toEqual(before);
    const restored = runMediaSafetyCommand([
      "resume",
      "--file",
      file,
      "--revision",
      String(status.revision),
      "--confirm",
      "resume-media",
    ]);
    if (!restored.initialized) throw new Error("fixture was not initialized");
    expect(restored.resumed).toBe(true);
    gate.finish(gate.begin(), 206);
  });
  test("损坏记录不重置，修复文件后仍需重建失败的服务实例", () => {
    writeFileSync(file, "broken");
    const gate = createPersistentMediaSafetyGate(file);
    expect(() => gate.begin()).toThrow();
    expect(() => runMediaSafetyCommand(["status", "--file", file])).toThrow();
    expect(readFileSync(file, "utf8")).toBe("broken");
    writeFileSync(file, JSON.stringify({ version: 1, revision: 10, reason: null, pending: [] }));
    expect(() => gate.begin()).toThrow();
    const restarted = createPersistentMediaSafetyGate(file);
    restarted.finish(restarted.begin(), 206);
  });
  test("恢复命令不创建新账本，不接受负数/重复/未知参数", () => {
    expect(() =>
      runMediaSafetyCommand(["resume", "--file", file, "--revision", "0", "--confirm", "resume-media"]),
    ).toThrow();
    expect(existsSync(file)).toBe(false);
    new MediaSafetyStore(file);
    for (const options of [
      ["--revision", "-1", "--confirm", "resume-media"],
      ["--revision", "0", "--revision", "0"],
      ["--force", "yes"],
    ]) {
      expect(() => runMediaSafetyCommand(["resume", "--file", file, ...options])).toThrow();
    }
  });
});
