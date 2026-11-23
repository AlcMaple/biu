import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { prepareWinCodeSign } from "../plugins/win-code-sign";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "biu-wincodesign-test-"));
  vi.stubEnv("ELECTRON_BUILDER_CACHE", root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

it("rejects a damaged download and leaves no reusable cache for it", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("incomplete archive"));
  vi.stubGlobal("fetch", fetch);

  await expect(prepareWinCodeSign()).rejects.toThrow("SHA-512 校验失败");
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(readdir(join(root, "winCodeSign"))).resolves.toEqual([]);
});

it("reuses existing Windows tools without contacting the download host", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const directory = join(root, "winCodeSign", "winCodeSign-2.6.0");
  await mkdir(join(directory, "windows-10/x64"), { recursive: true });
  await Promise.all(
    ["rcedit-x64.exe", "rcedit-ia32.exe", "windows-10/x64/signtool.exe"].map(file =>
      writeFile(join(directory, file), "test tool"),
    ),
  );

  await prepareWinCodeSign();
  expect(fetch).not.toHaveBeenCalled();
});
