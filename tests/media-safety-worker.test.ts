// @vitest-environment node
import { buildSync } from "esbuild";
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, rmdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, expect, test } from "vitest";

import { runMediaSafetyCommand } from "../web-server/media-safety-cli";
import { MediaSafetyStore } from "../web-server/media-safety-store";
import { MediaSafetyWorkerClient } from "../web-server/media-safety-worker-client";
import { isMediaSafetyWorkerReply, isMediaSafetyWorkerRequest } from "../web-server/media-safety-worker-protocol";

const workerCode = buildSync({
  entryPoints: [path.resolve("web-server/media-safety-worker.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  target: "node22",
}).outputFiles[0].text;
const stalledCode = buildSync({
  stdin: {
    contents: `import {parentPort,workerData} from 'node:worker_threads';
import {MediaSafetyStore} from './web-server/media-safety-store';
parentPort.on('message', () => {new MediaSafetyStore(workerData.file).begin(); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);});`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  target: "node22",
}).outputFiles[0].text;
let directory: string;
let file: string;
let clients: MediaSafetyWorkerClient[];
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "biu-worker-"));
  file = path.join(directory, "ledger.json");
  clients = [];
});
afterEach(async () => {
  await Promise.all(clients.map(client => client.close()));
  rmSync(directory, { recursive: true, force: true });
});
function client(code = workerCode, operationTimeoutMs = 5000) {
  const gate = new MediaSafetyWorkerClient(file, {
    createWorker: state => new Worker(code, { eval: true, workerData: { file: state } }),
    operationTimeoutMs,
  });
  clients.push(gate);
  return gate;
}
const read = () => new MediaSafetyStore(file).read();

test("构造与未启动的关闭均不创建账本", async () => {
  const gate = client();
  expect(existsSync(file)).toBe(false);
  await gate.close();
  await expect(gate.begin()).rejects.toMatchObject({ reason: "storage" });
  expect(existsSync(file)).toBe(false);
});

test.each([429, 503])("真实worker保留%s暂停和旧版本拒绝，明确恢复后同实例继续", async status => {
  const gate = client();
  const id = await gate.begin();
  const before = read();
  expect(before.pending).toEqual([id]);
  await expect(gate.finish(id, status)).rejects.toBeInstanceOf(Error);
  await expect(gate.begin()).rejects.toBeInstanceOf(Error);
  expect(() => new MediaSafetyStore(file).resume(before.revision)).toThrow("changed");
  const current = runMediaSafetyCommand(["status", "--file", file]);
  if (!current.initialized) throw new Error("fixture uninitialized");
  runMediaSafetyCommand([
    "resume",
    "--file",
    file,
    "--revision",
    String(current.revision),
    "--confirm",
    "resume-media",
  ]);
  await gate.finish(await gate.begin(), 206);
  expect(read().pending).toEqual([]);
});

test("16并发许可先落盘，收尾不丢更新", async () => {
  const gate = client();
  const ids = await Promise.all(Array.from({ length: 16 }, () => gate.begin()));
  expect(new Set(ids).size).toBe(16);
  expect(read().pending).toHaveLength(16);
  await Promise.all(ids.map(id => gate.finish(id, 206)));
  expect(read()).toMatchObject({ revision: 32, pending: [], reason: null });
});

test("主线程观察限制后不放行已排队的旧许可", async () => {
  const gate = client();
  const id = await gate.begin();
  const results = await Promise.allSettled([gate.begin(), gate.begin(), gate.finish(id, 429)]);
  expect(results.map(result => result.status)).toEqual(["rejected", "rejected", "rejected"]);
  expect(read().reason).toBe("rate-limit");
});

test("普通403、416和断线不自动判为上游惩罚", async () => {
  const gate = client();
  for (const status of [403, 416, "network"] as const) await gate.finish(await gate.begin(), status);
  expect(read()).toMatchObject({ reason: null, pending: [] });
});

test("未知旧响应即使晚于人工恢复仍保留待确认意图", async () => {
  const gate = client();
  const id = await gate.begin();
  new MediaSafetyStore(file).resume(read().revision);
  await gate.abandon(id);
  await expect(gate.begin()).rejects.toMatchObject({ reason: "unconfirmed" });
  expect(read().pending).toContain(id);
});

test("锁冲突停手，移除测试锁不自动重开失败实例", async () => {
  const gate = client();
  await gate.finish(await gate.begin(), 206);
  const before = readFileSync(file);
  mkdirSync(file + ".lock");
  await expect(gate.begin()).rejects.toMatchObject({ reason: "storage" });
  expect(readFileSync(file)).toEqual(before);
  rmdirSync(file + ".lock");
  await expect(gate.begin()).rejects.toMatchObject({ reason: "storage" });
});

test("关闭真实worker保留未确认意图，重开不发许可", async () => {
  const gate = client();
  await gate.begin();
  await gate.close();
  expect(read().pending).toHaveLength(1);
  await expect(client().begin()).rejects.toMatchObject({ reason: "unconfirmed" });
});

test("超时停止忙线程，保留已落盘但未收到许可的意图，不重试", async () => {
  const gate = client(stalledCode, 500);
  let ticked = false;
  const tick = setTimeout(() => {
    ticked = true;
  }, 20);
  await expect(gate.begin()).rejects.toMatchObject({ reason: "storage" });
  clearTimeout(tick);
  expect(ticked).toBe(true);
  await gate.close();
  expect(read().pending).toHaveLength(1);
  await expect(gate.begin()).rejects.toMatchObject({ reason: "storage" });
  await expect(client().begin()).rejects.toMatchObject({ reason: "unconfirmed" });
});

test("关闭拒绝全部在途RPC，不等待超时或自动重建线程", async () => {
  const gate = client("setInterval(() => {}, 1000)");
  const results = Promise.allSettled([gate.begin(), gate.begin()]);
  await gate.close();
  expect((await results).map(result => result.status)).toEqual(["rejected", "rejected"]);
  await expect(gate.begin()).rejects.toMatchObject({ reason: "storage" });
});

test.each([
  "throw Error('fixture worker crash')",
  "process.exit(0)",
  "require('node:worker_threads').parentPort.on('message',({id})=>require('node:worker_threads').parentPort.postMessage({id,ok:true}))",
  "require('node:worker_threads').parentPort.on('message',()=>require('node:worker_threads').parentPort.postMessage({id:999,ok:false,reason:'storage'}))",
])("worker异常/退出/坏协议都失败关闭：%s", async code => {
  const gate = client(code);
  await expect(gate.begin()).rejects.toMatchObject({ reason: "storage" });
  await expect(gate.begin()).rejects.toMatchObject({ reason: "storage" });
});

test("坏账本字节不被初始化覆盖", async () => {
  writeFileSync(file, "broken");
  const gate = client();
  await expect(gate.begin()).rejects.toMatchObject({ reason: "storage" });
  expect(readFileSync(file, "utf8")).toBe("broken");
});

test("排队入场有128上限，收尾保留容量", async () => {
  const gate = client();
  const results = await Promise.allSettled(Array.from({ length: 129 }, () => gate.begin()));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(128);
  expect(results[128]).toMatchObject({ status: "rejected", reason: { reason: "capacity" } });
  await Promise.all(results.flatMap(result => (result.status === "fulfilled" ? [gate.finish(result.value, 206)] : [])));
  expect(read().pending).toEqual([]);
});

test.each([0, -1, NaN, Infinity, 300001])("拒绝静默关闭或非法超时%s", operationTimeoutMs => {
  expect(() => new MediaSafetyWorkerClient(file, { operationTimeoutMs })).toThrow();
});

test("消息不接受任意方法、状态或伪造许可", () => {
  expect(isMediaSafetyWorkerRequest({ id: 1, method: "resume" })).toBe(false);
  expect(
    isMediaSafetyWorkerRequest({ id: 1, method: "finish", admission: "bad", status: 206, riskControl: false }),
  ).toBe(false);
  expect(isMediaSafetyWorkerReply({ id: 1, ok: true, admission: "bad" })).toBe(false);
  expect(isMediaSafetyWorkerReply({ id: 1, ok: false, reason: "invented" })).toBe(false);
});

test("许可已回复但调用方尚未收到时关闭，仍不交付许可", async () => {
  const gate = new MediaSafetyWorkerClient(file, {
    createWorker: state => {
      const worker = new Worker(workerCode, { eval: true, workerData: { file: state } });
      worker.on("message", () =>
        queueMicrotask(() => {
          void gate.close();
        }),
      );
      return worker;
    },
  });
  clients.push(gate);
  await expect(gate.begin()).rejects.toMatchObject({ reason: "storage" });
  await gate.close();
  expect(read().pending).toHaveLength(1);
});
