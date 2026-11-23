import { path7za } from "7zip-bin";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const tool = "winCodeSign-2.6.0";
const source = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${tool}/${tool}.7z`;
// Electron Builder 26.0.12 uses this asset and the SHA-512 published in its release notes.
const digest = "6LQI2d9BPC3Xs0ZoTQe1o3tPiA28c7+PY69Q9i/pD8lY45psMtHuLwv3vRckiVr3Zx1cbNyLlBR8STwCdcHwtA==";
const windowsTools = ["rcedit-x64.exe", "rcedit-ia32.exe", "windows-10/x64/signtool.exe"];

function getBuilderCache() {
  if (process.env.ELECTRON_BUILDER_CACHE) return process.env.ELECTRON_BUILDER_CACHE;
  const localAppData = process.env.LOCALAPPDATA;
  if (
    process.env.USERNAME?.toLowerCase() === "system" ||
    localAppData?.toLowerCase().includes("\\windows\\system32\\")
  ) {
    return join(tmpdir(), "electron-builder-cache");
  }
  if (localAppData) return join(localAppData, "electron-builder", "Cache");
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "electron-builder");
}

export async function prepareWinCodeSign() {
  const cache = resolve(getBuilderCache(), "winCodeSign");
  const target = join(cache, tool);
  const isReady = (directory: string) => windowsTools.every(filename => existsSync(join(directory, filename)));
  if (isReady(target)) return;

  await mkdir(cache, { recursive: true });
  const staging = await mkdtemp(join(cache, ".biu-"));
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha512").update(bytes).digest("base64") !== digest) throw new Error("下载文件的 SHA-512 校验失败");

    const archive = join(staging, "tool.7z");
    const unpacked = join(staging, "windows");
    await writeFile(archive, bytes);
    // The archive's macOS symlinks require extra privileges on Windows.
    await promisify(execFile)(path7za, ["x", "-bd", "-xr!darwin", `-o${unpacked}`, archive], { windowsHide: true });
    if (!isReady(unpacked)) throw new Error("压缩包缺少 Windows 打包工具");

    try {
      await rename(unpacked, target);
    } catch (error) {
      if (!isReady(target)) throw error;
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `无法准备 Windows 打包工具 ${tool}（${detail}）。请检查 GitHub Releases 的网络连接及缓存目录权限。`,
      {
        cause,
      },
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
