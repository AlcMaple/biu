import { createPublicKey, sign, verify } from "node:crypto";
import { gunzipSync } from "node:zlib";

export const MAX_SIGNED_BLOCKMAP_BYTES = 4 * 1024 * 1024;
const domain = Buffer.from("Biu NSIS block map v1\0");

export async function readBlockMapResponse(response) {
  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel();
    return null;
  }
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error(`读取更新分块索引失败（HTTP ${response.status}）`);
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks);
      size += value.length;
      if (size > MAX_SIGNED_BLOCKMAP_BYTES) {
        await reader.cancel();
        throw new Error("更新分块索引过大");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export function signInstallerBlockMap(compressedMap, installerSha512, installerSize, privateKey) {
  parseBlockMap(compressedMap, installerSize);
  const payload = Buffer.concat([domain, Buffer.from(installerSha512, "base64"), compressedMap]);
  const envelope = Buffer.concat([sign(null, payload, privateKey), payload]);
  if (envelope.length > MAX_SIGNED_BLOCKMAP_BYTES) throw new Error("更新分块索引过大");
  return envelope;
}

export function verifyInstallerBlockMap(envelope, publicKeyBase64, installerSha512, installerSize) {
  const payload = envelope.subarray(64);
  const key = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), type: "spki", format: "der" });
  if (
    envelope.length > MAX_SIGNED_BLOCKMAP_BYTES ||
    !payload.subarray(0, domain.length).equals(domain) ||
    !verify(null, payload, key, envelope.subarray(0, 64))
  )
    throw new Error("更新分块索引签名无效");
  if (payload.subarray(domain.length, domain.length + 64).toString("base64") !== installerSha512) return null;
  return parseBlockMap(payload.subarray(domain.length + 64), installerSize);
}

function parseBlockMap(compressedMap, installerSize) {
  const map = JSON.parse(gunzipSync(compressedMap, { maxOutputLength: 16 * 1024 * 1024 }));
  const file = map.files?.[0];
  if (
    map.version !== "2" ||
    map.files?.length !== 1 ||
    file?.name !== "file" ||
    file.offset !== 0 ||
    !Array.isArray(file.sizes) ||
    !Array.isArray(file.checksums) ||
    file.sizes.length !== file.checksums.length ||
    file.sizes.some(size => !Number.isSafeInteger(size) || size < 1) ||
    file.sizes.reduce((sum, size) => sum + size, 0) !== installerSize ||
    file.checksums.some(checksum => typeof checksum !== "string" || !checksum)
  )
    throw new Error("更新分块索引与安装包大小或格式不符");
  return map;
}
