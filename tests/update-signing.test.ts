import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createSignedUpdateEnvelope,
  createWindowsUpdateMetadata,
  getWindowsUpdateManifestFilename,
  normalizeUpdateOrigin,
  resolveTrustedUpdateInstallerUrl,
  verifySignedUpdateEnvelope,
} from "../shared/update-signing.js";

function createTestTrust() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    keyId: "ed25519-test-key",
    privateKey,
    publicKeyBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

function createMetadata() {
  return createWindowsUpdateMetadata({
    arch: "x64",
    filename: "Biu-2.5.5-win-setup-x64.exe",
    releaseDate: "2026-08-24T00:00:00.000Z",
    releaseNotes: "安全更新测试",
    sha512: Buffer.alloc(64, 9).toString("base64"),
    size: 123456,
    version: "2.5.5",
  });
}

describe("Ed25519 update manifest", () => {
  it("accepts an intact signed Windows installer manifest", () => {
    const trust = createTestTrust();
    const envelope = createSignedUpdateEnvelope(createMetadata(), trust.privateKey, { keyId: trust.keyId });

    expect(verifySignedUpdateEnvelope(envelope, trust)).toMatchObject({
      arch: "x64",
      version: "2.5.5",
      files: [{ url: "Biu-2.5.5-win-setup-x64.exe" }],
    });
  });

  it("rejects a manifest whose installer hash changes after signing", () => {
    const trust = createTestTrust();
    const envelope = createSignedUpdateEnvelope(createMetadata(), trust.privateKey, { keyId: trust.keyId });
    const tampered = JSON.parse(envelope) as { payload: string };
    const metadata = JSON.parse(Buffer.from(tampered.payload, "base64").toString("utf8")) as {
      sha512: string;
      files: [{ sha512: string }];
    };
    metadata.sha512 = Buffer.alloc(64, 8).toString("base64");
    metadata.files[0].sha512 = metadata.sha512;
    tampered.payload = Buffer.from(JSON.stringify(metadata), "utf8").toString("base64");

    expect(() => verifySignedUpdateEnvelope(JSON.stringify(tampered), trust)).toThrow(/签名校验失败/);
  });

  it("rejects a signed but unsafe artifact path", () => {
    const trust = createTestTrust();
    const unsafeMetadata = {
      ...createMetadata(),
      files: [{ ...createMetadata().files[0], url: "../Biu-2.5.5-win-setup-x64.exe" }],
      path: "../Biu-2.5.5-win-setup-x64.exe",
    };
    const payload = Buffer.from(JSON.stringify(unsafeMetadata), "utf8");
    const envelope = JSON.stringify({
      schemaVersion: 1,
      algorithm: "ed25519",
      keyId: trust.keyId,
      payload: payload.toString("base64"),
      signature: sign(null, payload, trust.privateKey).toString("base64"),
    });

    expect(() => verifySignedUpdateEnvelope(envelope, trust)).toThrow(/安装包文件名不合法/);
  });

  it("accepts only HTTPS origins and architecture-specific filenames", () => {
    const origin = normalizeUpdateOrigin("https://updates.example.com/biu/");
    expect(origin.toString()).toBe("https://updates.example.com/biu/");
    expect(resolveTrustedUpdateInstallerUrl(origin, "Biu-2.5.5-win-setup-x64.exe").toString()).toBe(
      "https://updates.example.com/biu/Biu-2.5.5-win-setup-x64.exe",
    );
    expect(() => resolveTrustedUpdateInstallerUrl(origin, "../Biu-2.5.5-win-setup-x64.exe")).toThrow(
      /安装包文件名不合法/,
    );
    expect(() => normalizeUpdateOrigin("http://updates.example.com/biu/")).toThrow(/HTTPS/);
    expect(() => normalizeUpdateOrigin("https://token@updates.example.com/biu/")).toThrow(/HTTPS/);
    expect(getWindowsUpdateManifestFilename("x64")).toBe("latest.json");
    expect(getWindowsUpdateManifestFilename("arm64")).toBe("latest-arm64.json");
  });
});
