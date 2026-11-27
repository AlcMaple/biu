import type { CancellationToken, ProgressInfo } from "electron-updater";
import type { FileHandle } from "node:fs/promises";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";

import { type ByteRange, writeAt } from "./reuse-installer";

const CONNECTIONS = 4;
const PART_SIZE = 4 * 1024 * 1024;

export async function downloadInstaller({
  size,
  sha512,
  destination,
  cancellationToken,
  request,
  onProgress,
  reuse,
}: {
  size: number;
  sha512: string;
  destination: string;
  cancellationToken: CancellationToken;
  request: (range: string, signal: AbortSignal) => Promise<Response>;
  onProgress: (progress: ProgressInfo) => void;
  reuse?: (target: FileHandle, signal: AbortSignal) => Promise<ByteRange[] | undefined>;
}) {
  const file = await open(destination, "w");
  const controller = new AbortController();
  const { signal } = controller;
  const cancel = () => controller.abort(new Error("更新下载已取消"));
  cancellationToken.once("cancel", cancel);
  if (cancellationToken.cancelled) cancel();
  let timeout: NodeJS.Timeout | undefined;
  const parts: ByteRange[] = [];
  let total = size;
  let transferred = 0;
  let previousBytes = 0;
  let previousTime = performance.now();

  function progress(complete = false) {
    const now = performance.now();
    const elapsed = now - previousTime;
    if (!complete && (elapsed < 500 || transferred === total)) return;
    const delta = transferred - previousBytes;
    onProgress({
      total,
      transferred,
      percent: complete ? 100 : (100 * transferred) / total,
      delta,
      bytesPerSecond: Math.round((delta * 1000) / Math.max(1, elapsed)),
    });
    previousBytes = transferred;
    previousTime = now;
  }

  async function writePart(response: Response, start: number, end: number) {
    if (response.status !== 200 && response.status !== 206) throw new Error(`下载更新失败（HTTP ${response.status}）`);
    if (
      (response.status === 206 && response.headers.get("content-range") !== `bytes ${start}-${end}/${size}`) ||
      (response.status === 200 && (start !== 0 || end !== size - 1))
    )
      throw new Error("服务器返回的更新包范围与请求不一致");
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) !== end - start + 1) throw new Error("更新包响应长度不一致");
    if (!response.body) throw new Error("更新包响应为空");
    const reader = response.body.getReader();
    let position = start;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        timeout?.refresh();
        if (position + value.byteLength > end + 1) throw new Error("更新包响应超出请求范围");
        await writeAt(file, value, position);
        position += value.byteLength;
        transferred += value.byteLength;
        progress();
      }
      if (position !== end + 1) throw new Error("更新包下载不完整");
    } finally {
      reader.releaseLock();
    }
  }

  async function downloadRemaining() {
    for (let part = parts.shift(); part; part = parts.shift()) {
      signal.throwIfAborted();
      const start = part.start;
      const end = part.end - 1;
      await writePart(await request(`bytes=${start}-${end}`, signal), start, end);
    }
  }

  const workers: Promise<void>[] = [];
  try {
    signal.throwIfAborted();
    const missing = (await reuse?.(file, signal)) ?? [{ start: 0, end: size }];
    total = missing.reduce((sum, range) => sum + range.end - range.start, 0);
    const partSize = Math.min(PART_SIZE, Math.max(1, Math.ceil(total / CONNECTIONS)));
    for (const range of missing) {
      for (let start = range.start; start < range.end; start += partSize) {
        parts.push({ start, end: Math.min(start + partSize, range.end) });
      }
    }
    const part = parts.shift();
    if (part) {
      timeout = setTimeout(() => controller.abort(new Error("更新下载超时，服务器长时间未返回数据")), 60_000);
      const first = await request(`bytes=${part.start}-${part.end - 1}`, signal);
      if (first.status === 416) {
        await first.body?.cancel();
        return false;
      }
      if (first.status === 206) {
        // 首个区间确认受支持后才并发，忽略 Range 的站点只会传一次整包。
        if (first.headers.get("content-range") !== `bytes ${part.start}-${part.end - 1}/${size}`)
          throw new Error("服务器返回的更新包范围与请求不一致");
        workers.push(writePart(first, part.start, part.end - 1).then(downloadRemaining));
        for (let i = 1; i < CONNECTIONS && parts.length; i++) workers.push(downloadRemaining());
      } else {
        total = size;
        workers.push(writePart(first, 0, size - 1));
      }
    }
    await Promise.all(workers);
    clearTimeout(timeout);
    const hash = createHash("sha512");
    for await (const chunk of createReadStream(destination, { signal, highWaterMark: 1024 * 1024 })) hash.update(chunk);
    if (hash.digest("base64") !== sha512) throw new Error("更新包 SHA-512 校验失败");
    progress(true);
    return true;
  } catch (error) {
    controller.abort(error);
    await Promise.allSettled(workers);
    throw signal.reason;
  } finally {
    clearTimeout(timeout);
    cancellationToken.removeListener("cancel", cancel);
    await file.close();
  }
}
