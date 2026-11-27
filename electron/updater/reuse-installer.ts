import type { FileHandle } from "node:fs/promises";

import { computeOperations, OperationKind } from "electron-updater/out/differentialDownloader/downloadPlanBuilder.js";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

import { readBlockMapResponse, verifyInstallerBlockMap } from "../../shared/update-blockmap.js";

export type ByteRange = { start: number; end: number }; // end 为开区间

export async function writeAt(file: FileHandle, data: Uint8Array, position: number) {
  let offset = 0;
  while (offset < data.byteLength) {
    const { bytesWritten } = await file.write(data, offset, data.byteLength - offset, position + offset);
    if (!bytesWritten) throw new Error("无法写入更新包");
    offset += bytesWritten;
  }
}

export async function reuseInstallerBlocks({
  cachedInstaller,
  target,
  size,
  sha512,
  publicKey,
  requestIndex,
  signal,
  log,
}: {
  cachedInstaller: string;
  target: FileHandle;
  size: number;
  sha512: string;
  publicKey: string;
  requestIndex: (version: "current" | "latest") => Promise<Response>;
  signal: AbortSignal;
  log: { info: (message: string) => void; warn: (message: string) => void; error: (message: string) => void };
}): Promise<ByteRange[] | undefined> {
  let old: FileHandle;
  try {
    old = await open(cachedInstaller, "r");
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
    throw error;
  }
  try {
    const stat = await old.stat();
    if (!stat.isFile() || !stat.size || stat.size > 4 * 1024 ** 3) return;
    const oldIndex = await readBlockMapResponse(await requestIndex("current"));
    if (!oldIndex) return;
    const oldHash = createHash("sha512");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const oldSize = stat.size;
    for (let pos = 0; pos < oldSize; ) {
      signal.throwIfAborted();
      const { bytesRead } = await old.read(buffer, 0, Math.min(buffer.length, oldSize - pos), pos);
      if (!bytesRead) return;
      oldHash.update(buffer.subarray(0, bytesRead));
      pos += bytesRead;
    }
    const oldMap = verifyInstallerBlockMap(oldIndex, publicKey, oldHash.digest("base64"), oldSize);
    if (!oldMap) return;
    const newIndex = await readBlockMapResponse(await requestIndex("latest"));
    if (!newIndex) return;
    const newMap = verifyInstallerBlockMap(newIndex, publicKey, sha512, size);
    if (!newMap) throw new Error("更新分块索引与签名清单不匹配");
    const missing: ByteRange[] = [];
    let position = 0;
    for (const op of computeOperations(oldMap, newMap, log)) {
      signal.throwIfAborted();
      const length = op.end - op.start;
      // 几 KB 的可复用碎片会把原本连续的网络请求切碎，额外往返比节省的流量贵。
      if (op.kind === OperationKind.COPY && length >= 128 * 1024) {
        for (let offset = 0; offset < length; ) {
          signal.throwIfAborted();
          const { bytesRead } = await old.read(buffer, 0, Math.min(buffer.length, length - offset), op.start + offset);
          if (!bytesRead) return;
          await writeAt(target, buffer.subarray(0, bytesRead), position + offset);
          offset += bytesRead;
        }
      } else {
        const previous = missing.at(-1);
        if (previous?.end === position) previous.end += length;
        else missing.push({ start: position, end: position + length });
      }
      position += length;
    }
    return missing;
  } finally {
    await old.close();
  }
}
