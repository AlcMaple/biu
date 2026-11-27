#!/usr/bin/env node
import { parseArgs } from "node:util";

import { readBlockMapResponse, verifyInstallerBlockMap } from "../shared/update-blockmap.js";
import { UPDATE_SIGNING_PUBLIC_KEY_BASE64 } from "../shared/update-signing-public-key.js";
import {
  UPDATE_ENVELOPE_MAX_BYTES,
  getWindowsUpdateManifestFilename,
  normalizeUpdateOrigin,
  resolveTrustedUpdateInstallerUrl,
  verifySignedUpdateEnvelope,
} from "../shared/update-signing.js";
import { readUpdateYamlVersion } from "./update-artifacts.js";
import { loadUpdateEnvironment } from "./update-env.js";

loadUpdateEnvironment();
const { values } = parseArgs({
  options: {
    x64: { type: "boolean" },
    arm64: { type: "boolean" },
    mac: { type: "boolean" },
    version: { type: "string" },
    blockmap: { type: "boolean" },
  },
});
if ([values.x64, values.arm64, values.mac].filter(Boolean).length > 1)
  throw new Error("一次只能指定 --x64、--arm64 或 --mac 中的一项。");

const origin = normalizeUpdateOrigin(process.env.BIU_UPDATE_PUBLIC_ORIGIN || "");
const arch = values.arm64 ? "arm64" : "x64";
const manifest = values.mac ? "latest-mac.yml" : getWindowsUpdateManifestFilename(arch);
const manifestUrl = new URL(manifest, origin);
manifestUrl.searchParams.set("noCache", `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const response = await fetch(manifestUrl, {
  cache: "no-store",
  redirect: "error",
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`更新清单请求失败：HTTP ${response.status}`);
const declaredLength = Number(response.headers.get("content-length"));
if (Number.isFinite(declaredLength) && declaredLength > UPDATE_ENVELOPE_MAX_BYTES) {
  throw new Error("更新清单响应过大");
}

const reader = response.body?.getReader();
if (!reader) throw new Error("更新清单响应为空");
const chunks = [];
let receivedBytes = 0;
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  receivedBytes += value.byteLength;
  if (receivedBytes > UPDATE_ENVELOPE_MAX_BYTES) {
    await reader.cancel();
    throw new Error("更新清单响应过大");
  }
  chunks.push(value);
}
const rawManifest = Buffer.concat(chunks).toString("utf8");
const metadata = values.mac ? null : verifySignedUpdateEnvelope(rawManifest);
if (metadata && metadata.arch !== arch) throw new Error("更新清单架构与请求架构不一致");
const version = metadata?.version ?? readUpdateYamlVersion(rawManifest);
if (!version) throw new Error(`公开更新清单 ${manifest} 缺少版本号。`);
if (values.version !== undefined && version !== values.version)
  throw new Error(`公开更新清单 ${manifest} 为 ${version}，期望 ${values.version}。`);

if (metadata && values.version !== undefined) {
  const installer = await fetch(resolveTrustedUpdateInstallerUrl(origin, metadata.path), {
    method: "HEAD",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!installer.ok) throw new Error(`安装包 ${metadata.path} 请求失败：HTTP ${installer.status}`);
  const size = installer.headers.get("content-length");
  if (size !== null && Number(size) !== metadata.files[0].size)
    throw new Error(`安装包 ${metadata.path} 大小与签名清单不一致。`);
}

if (values.blockmap) {
  if (!metadata) throw new Error("分块索引仅适用于 Windows 安装包");
  const installer = resolveTrustedUpdateInstallerUrl(origin, metadata.path);
  const response = await fetch(`${installer.href}.blockmap.signed`, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const signedMap = await readBlockMapResponse(response);
  if (
    !signedMap ||
    !verifyInstallerBlockMap(signedMap, UPDATE_SIGNING_PUBLIC_KEY_BASE64, metadata.sha512, metadata.files[0].size)
  )
    throw new Error(`安装包 ${metadata.path} 缺少对应的签名分块索引`);
}

console.log(`已验证 ${manifest}：v${version}`);
