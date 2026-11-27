// @vitest-environment node
import electronUpdater, { type ProgressInfo } from "electron-updater";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { downloadInstaller } from "../electron/updater/download-installer";

const bytes = randomBytes(1025);
const sha512 = createHash("sha512").update(bytes).digest("base64");
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "biu-download-test-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function setup(request: (range: string, signal: AbortSignal) => Promise<Response>) {
  const cancellationToken = new electronUpdater.CancellationToken();
  const destination = path.join(directory, "update.exe");
  const onProgress = vi.fn<(progress: ProgressInfo) => void>();
  const download = () =>
    downloadInstaller({ size: bytes.length, destination, sha512, request, cancellationToken, onProgress });
  return { cancellationToken, destination, onProgress, download };
}

function partial(range: string) {
  const [start, end] = range.slice(6).split("-").map(Number);
  return new Response(bytes.subarray(start, end + 1), {
    status: 206,
    headers: { "content-range": `bytes ${start}-${end}/${bytes.length}` },
  });
}

it("downloads four disjoint ranges concurrently and assembles out-of-order responses", async () => {
  const ranges: string[] = [];
  let release: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const { download, destination, onProgress } = setup(async range => {
    ranges.push(range);
    if (ranges.length === 4) release();
    if (range === "bytes=0-256") {
      return new Response(
        new ReadableStream({
          async start(controller) {
            await gate;
            controller.enqueue(bytes.subarray(0, 257));
            controller.close();
          },
        }),
        { status: 206, headers: { "content-range": "bytes 0-256/1025" } },
      );
    }
    await gate;
    return partial(range);
  });
  await download();
  expect(ranges).toEqual(["bytes=0-256", "bytes=257-513", "bytes=514-770", "bytes=771-1024"]);
  expect(await readFile(destination)).toEqual(bytes);
  expect(onProgress).toHaveBeenLastCalledWith(
    expect.objectContaining({ transferred: bytes.length, total: bytes.length, percent: 100 }),
  );
});

it("consumes a full response to the first range without downloading it again", async () => {
  const request = vi.fn(async () => new Response(bytes));
  const { download, destination } = setup(request);
  await download();
  expect(request).toHaveBeenCalledTimes(1);
  expect(await readFile(destination)).toEqual(bytes);
});

it("hands an explicitly rejected first range back to the regular NSIS download", async () => {
  const request = vi.fn(async () => new Response(null, { status: 416 }));
  expect(await setup(request).download()).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  [() => new Response(null, { status: 429 }), "HTTP 429"],
  [() => new Response(null, { status: 503 }), "HTTP 503"],
  [() => new Response(bytes, { status: 206, headers: { "content-range": "bytes 0-256/4096" } }), "范围"],
  [() => new Response(bytes.subarray(1)), "不完整"],
  [() => new Response(new Uint8Array(bytes.length + 1)), "超出"],
  [() => new Response(new Uint8Array(bytes.length)), "SHA-512"],
] as const)("rejects an unusable first response without retrying (%#)", async (response, message) => {
  const request = vi.fn(async () => response());
  const { download, onProgress } = setup(request);
  await expect(download()).rejects.toThrow(message);
  expect(request).toHaveBeenCalledTimes(1);
  expect(onProgress.mock.calls.some(([progress]) => progress.percent === 100)).toBe(false);
});

it("aborts outstanding ranges when one range fails", async () => {
  const aborted = vi.fn();
  const { download } = setup(async (range, signal) => {
    if (range === "bytes=0-256") return partial(range);
    if (range === "bytes=257-513") return new Response(bytes);
    return new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted();
          reject(signal.reason);
        },
        { once: true },
      );
    });
  });
  await expect(download()).rejects.toThrow("范围");
  expect(aborted).toHaveBeenCalledTimes(2);
});

it("honors cancellation during the transfer and releases the temporary file", async () => {
  const { download, cancellationToken, destination } = setup(
    async (_range, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        cancellationToken.cancel();
      }),
  );
  await expect(download()).rejects.toThrow("已取消");
  await rm(destination);
});
