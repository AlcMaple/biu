import { createPublicKey, sign, verify } from "node:crypto";

import {
  UPDATE_SIGNING_ALGORITHM,
  UPDATE_SIGNING_KEY_ID,
  UPDATE_SIGNING_PUBLIC_KEY_BASE64,
} from "./update-signing-public-key.js";

export const UPDATE_MANIFEST_SCHEMA_VERSION = 1;
export const UPDATE_MANIFEST_MAX_BYTES = 64 * 1024;
export const UPDATE_ENVELOPE_MAX_BYTES = 128 * 1024;

const RELEASE_NOTES_MAX_BYTES = 16 * 1024;
const MAX_INSTALLER_SIZE = 4 * 1024 * 1024 * 1024;
const WINDOWS_ARCHITECTURES = new Set(["x64", "arm64"]);
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const ARTIFACT_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/;

/** @returns {never} */
function fail(message) {
  throw new Error(`更新清单无效：${message}`);
}

function assertPlainObject(value, field) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${field} 必须是对象`);
  }
  return value;
}

function assertExactKeys(value, allowedKeys, field) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(`${field} 包含不支持字段 ${key}`);
  }
}

function decodeCanonicalBase64(value, field) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    fail(`${field} 不是规范 base64`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value) fail(`${field} 不是规范 base64`);
  return decoded;
}

function assertSha512(value, field) {
  const decoded = decodeCanonicalBase64(value, field);
  if (decoded.length !== 64) fail(`${field} 必须是 SHA-512`);
}

function assertVersion(value) {
  if (typeof value !== "string" || value.length > 128 || !VERSION_PATTERN.test(value)) fail("version 格式不合法");
}

function assertInstallerFilename(value) {
  if (typeof value !== "string" || !ARTIFACT_FILENAME_PATTERN.test(value) || value.includes("..")) {
    fail("安装包文件名不合法");
  }
}

function parseJson(raw, field) {
  try {
    return JSON.parse(raw);
  } catch {
    fail(`${field} 不是有效 JSON`);
  }
}

function toBuffer(value, field, maxBytes) {
  const result = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  if (result.length === 0 || result.length > maxBytes) fail(`${field} 大小不合法`);
  return result;
}

export function getWindowsUpdateManifestFilename(arch) {
  if (arch === "x64") return "latest.json";
  if (arch === "arm64") return "latest-arm64.json";
  fail("不支持的 Windows 架构");
}

export function normalizeUpdateOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("更新源 URL 不合法");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    fail("更新源必须是无凭据的 HTTPS URL");
  }
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url;
}

export function resolveTrustedUpdateInstallerUrl(baseUrl, filename) {
  assertInstallerFilename(filename);
  const fileUrl = new URL(filename, baseUrl);
  if (
    fileUrl.origin !== baseUrl.origin ||
    !fileUrl.pathname.startsWith(baseUrl.pathname) ||
    fileUrl.search ||
    fileUrl.hash
  ) {
    fail("安装包地址越过受信任 HTTPS 更新目录");
  }
  return fileUrl;
}

export function parseWindowsUpdateMetadata(rawMetadata) {
  const bytes = toBuffer(rawMetadata, "更新元数据", UPDATE_MANIFEST_MAX_BYTES);
  const metadata = assertPlainObject(parseJson(bytes.toString("utf8"), "更新元数据"), "更新元数据");
  assertExactKeys(
    metadata,
    new Set(["schemaVersion", "platform", "arch", "version", "files", "path", "sha512", "releaseDate", "releaseNotes"]),
    "更新元数据",
  );

  if (metadata.schemaVersion !== UPDATE_MANIFEST_SCHEMA_VERSION) fail("schemaVersion 不受支持");
  if (metadata.platform !== "win32") fail("platform 必须是 win32");
  if (!WINDOWS_ARCHITECTURES.has(metadata.arch)) fail("arch 不受支持");
  assertVersion(metadata.version);
  if (!Array.isArray(metadata.files) || metadata.files.length !== 1) fail("files 必须只包含一个安装包");

  const file = assertPlainObject(metadata.files[0], "files[0]");
  assertExactKeys(file, new Set(["url", "sha512", "size"]), "files[0]");
  assertInstallerFilename(file.url);
  if (file.url !== `Biu-${metadata.version}-win-setup-${metadata.arch}.exe`) {
    fail("安装包文件名与版本或架构不匹配");
  }
  assertSha512(file.sha512, "files[0].sha512");
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_INSTALLER_SIZE) {
    fail("files[0].size 不合法");
  }

  if (metadata.path !== file.url) fail("path 必须与 files[0].url 一致");
  assertSha512(metadata.sha512, "sha512");
  if (metadata.sha512 !== file.sha512) fail("sha512 必须与 files[0].sha512 一致");
  if (
    typeof metadata.releaseDate !== "string" ||
    metadata.releaseDate.length > 64 ||
    Number.isNaN(Date.parse(metadata.releaseDate))
  ) {
    fail("releaseDate 不合法");
  }
  if (metadata.releaseNotes !== undefined) {
    if (
      typeof metadata.releaseNotes !== "string" ||
      Buffer.byteLength(metadata.releaseNotes, "utf8") > RELEASE_NOTES_MAX_BYTES
    ) {
      fail("releaseNotes 不合法");
    }
  }

  return metadata;
}

export function createWindowsUpdateMetadata({ arch, filename, releaseDate, releaseNotes, sha512, size, version }) {
  const metadata = {
    schemaVersion: UPDATE_MANIFEST_SCHEMA_VERSION,
    platform: "win32",
    arch,
    version,
    files: [{ url: filename, sha512, size }],
    path: filename,
    sha512,
    releaseDate,
    ...(releaseNotes ? { releaseNotes } : {}),
  };
  parseWindowsUpdateMetadata(JSON.stringify(metadata));
  return metadata;
}

export function createSignedUpdateEnvelope(metadata, privateKey, { keyId = UPDATE_SIGNING_KEY_ID } = {}) {
  if (typeof keyId !== "string" || keyId.length < 8 || keyId.length > 128) fail("keyId 不合法");
  const payload = Buffer.from(JSON.stringify(metadata), "utf8");
  parseWindowsUpdateMetadata(payload);
  const signature = sign(null, payload, privateKey).toString("base64");
  return `${JSON.stringify({
    schemaVersion: UPDATE_MANIFEST_SCHEMA_VERSION,
    algorithm: UPDATE_SIGNING_ALGORITHM,
    keyId,
    payload: payload.toString("base64"),
    signature,
  })}\n`;
}

export function verifySignedUpdateEnvelope(
  rawEnvelope,
  { keyId = UPDATE_SIGNING_KEY_ID, publicKeyBase64 = UPDATE_SIGNING_PUBLIC_KEY_BASE64 } = {},
) {
  const bytes = toBuffer(rawEnvelope, "签名更新清单", UPDATE_ENVELOPE_MAX_BYTES);
  const envelope = assertPlainObject(parseJson(bytes.toString("utf8"), "签名更新清单"), "签名更新清单");
  assertExactKeys(envelope, new Set(["schemaVersion", "algorithm", "keyId", "payload", "signature"]), "签名更新清单");
  if (envelope.schemaVersion !== UPDATE_MANIFEST_SCHEMA_VERSION) fail("签名清单 schemaVersion 不受支持");
  if (envelope.algorithm !== UPDATE_SIGNING_ALGORITHM) fail("签名算法不受支持");
  if (envelope.keyId !== keyId) fail("签名密钥标识不匹配");

  const payload = decodeCanonicalBase64(envelope.payload, "payload");
  if (payload.length > UPDATE_MANIFEST_MAX_BYTES) fail("payload 大小不合法");
  const signature = decodeCanonicalBase64(envelope.signature, "signature");
  if (signature.length !== 64) fail("signature 长度不合法");

  let publicKey;
  try {
    publicKey = createPublicKey({
      key: decodeCanonicalBase64(publicKeyBase64, "publicKey"),
      format: "der",
      type: "spki",
    });
  } catch {
    fail("公开验证密钥不合法");
  }
  if (publicKey.asymmetricKeyType !== UPDATE_SIGNING_ALGORITHM) fail("公开验证密钥类型不合法");
  if (!verify(null, payload, publicKey, signature)) fail("签名校验失败");
  return parseWindowsUpdateMetadata(payload);
}
