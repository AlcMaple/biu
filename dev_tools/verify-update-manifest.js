#!/usr/bin/env node
/** Verify the public, Ed25519-signed Windows update manifest without downloading an installer. */
import {
  UPDATE_ENVELOPE_MAX_BYTES,
  getWindowsUpdateManifestFilename,
  normalizeUpdateOrigin,
  verifySignedUpdateEnvelope,
} from "../shared/update-signing.js";

const args = new Set(process.argv.slice(2));
if ([...args].some(arg => arg !== "--arm64" && arg !== "--x64")) {
  throw new Error("只支持 --x64 或 --arm64");
}
if (args.has("--arm64") && args.has("--x64")) {
  throw new Error("一次只能验证一种 Windows 架构");
}

const origin = normalizeUpdateOrigin(process.env.BIU_UPDATE_PUBLIC_ORIGIN || "");
const arch = args.has("--arm64") ? "arm64" : "x64";
const manifestUrl = new URL(getWindowsUpdateManifestFilename(arch), origin);
manifestUrl.searchParams.set("noCache", `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const response = await fetch(manifestUrl, { cache: "no-store", redirect: "error" });
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
const metadata = verifySignedUpdateEnvelope(rawManifest);
if (metadata.arch !== arch) throw new Error("更新清单架构与请求架构不一致");

console.log(`已验证 Ed25519 更新清单：v${metadata.version} (${metadata.arch}) → ${metadata.path}`);
