// @vitest-environment node
import electronUpdater from "electron-updater";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { downloadInstaller } from "../electron/updater/download-installer";
import { reuseInstallerBlocks } from "../electron/updater/reuse-installer";
import { signInstallerBlockMap } from "../shared/update-blockmap.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const digest = (data: Buffer) => createHash("sha512").update(data).digest("base64");
const common = randomBytes(256 * 1024);
const latestChunks = [randomBytes(1234), common, randomBytes(701)];
const currentChunks = [common, randomBytes(4000)];
const latest = Buffer.concat(latestChunks);
const current = Buffer.concat(currentChunks);
let directory: string;

function signedIndex(chunks: Buffer[]) {
  const file = { name: "file", offset: 0, checksums: chunks.map(digest), sizes: chunks.map(c => c.length) };
  return signInstallerBlockMap(
    gzipSync(JSON.stringify({ version: "2", files: [file] })),
    digest(Buffer.concat(chunks)),
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    privateKey,
  );
}

const indexes = { current: signedIndex(currentChunks), latest: signedIndex(latestChunks) };
const indexResponse = async (version: keyof typeof indexes) => new Response(new Uint8Array(indexes[version]));
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "biu-reuse-test-"));
  await writeFile(path.join(directory, "installer.exe"), current);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function transfer(requestIndex = indexResponse, ignoreRange = false) {
  let received = 0;
  const destination = path.join(directory, "update.exe");
  await downloadInstaller({
    destination,
    size: latest.length,
    sha512: digest(latest),
    cancellationToken: new electronUpdater.CancellationToken(),
    onProgress: vi.fn(),
    reuse: (target, signal) =>
      reuseInstallerBlocks({
        cachedInstaller: path.join(directory, "installer.exe"),
        target,
        signal,
        size: latest.length,
        sha512: digest(latest),
        publicKey: publicKeyBase64,
        requestIndex,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }),
    request: async range => {
      if (ignoreRange) {
        received += latest.length;
        return new Response(latest);
      }
      const [start, end] = range.slice(6).split("-").map(Number);
      received += end - start + 1;
      return new Response(latest.subarray(start, end + 1), {
        status: 206,
        headers: { "content-range": `bytes ${start}-${end}/${latest.length}` },
      });
    },
  });
  expect((await readFile(destination)).equals(latest)).toBe(true);
  return received;
}

it("reuses a relocated run from the verified old installer and downloads only the gaps", async () => {
  expect(await transfer()).toBe(latest.length - common.length);
});

it("uses the first full response when the server ignores a differential range", async () => {
  expect(await transfer(indexResponse, true)).toBe(latest.length);
});

it("downloads the full installer when the cached file differs from the signed old index", async () => {
  await writeFile(path.join(directory, "installer.exe"), randomBytes(current.length));
  const index = vi.fn(indexResponse);
  expect(await transfer(index)).toBe(latest.length);
  expect(index.mock.calls).toEqual([["current"]]);
});

it("supports a release without signed indexes", async () => {
  expect(await transfer(async () => new Response(null, { status: 404 }))).toBe(latest.length);
});

it("stops on rate limiting of the index without requesting installer ranges", async () => {
  const index = vi.fn(async () => new Response(null, { status: 429 }));
  await expect(transfer(index)).rejects.toThrow("HTTP 429");
  expect(index).toHaveBeenCalledTimes(1);
});

it("refuses to sign a block map from an incorrectly sized build", () => {
  const map = gzipSync(
    JSON.stringify({ version: "2", files: [{ name: "file", offset: 0, sizes: [1], checksums: ["abc"] }] }),
  );
  expect(() => signInstallerBlockMap(map, digest(latest), latest.length, privateKey)).toThrow("大小或格式不符");
});

it("rejects altered index bytes before using offsets", async () => {
  const broken = new Uint8Array(indexes.latest);
  broken[broken.length - 1] ^= 1;
  await expect(
    transfer(async version => (version === "latest" ? new Response(broken) : indexResponse(version))),
  ).rejects.toThrow("签名无效");
});

it("rejects a valid index for a different target installer", async () => {
  await expect(transfer(async () => indexResponse("current"))).rejects.toThrow("与签名清单不匹配");
});
