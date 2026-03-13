import { app } from "electron";
import isDev from "electron-is-dev";
import log from "electron-log";
import got from "got";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { getCookieString } from "../../network/cookie";
import { UserAgent } from "../../network/user-agent";

export interface WhisperXSyncParams {
  audioUrl: string;
  lrc: string;
  language?: string;
  /** 本地已下载的音频文件路径，提供时跳过 CDN 下载 */
  localFilePath?: string;
}

function scriptPath(name: string): string {
  const base = isDev ? process.cwd() : process.resourcesPath;
  return path.join(base, "electron", "python", name);
}

/** Environment overrides that bypass SSL cert verification for model downloads. */
const sslEnv = {
  ...process.env,
  PYTHONHTTPSVERIFY: "0",
  CURL_CA_BUNDLE: "",
  REQUESTS_CA_BUNDLE: "",
};

/** Auto-detect spoken language from plain-text lyric content. */
function detectLanguage(text: string): string {
  const cjk = (text.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) ?? []).length;
  const kana = (text.match(/[\u3040-\u30FF]/g) ?? []).length;
  const hangul = (text.match(/[\uAC00-\uD7AF]/g) ?? []).length;
  if (cjk + kana + hangul === 0) return "en";
  if (kana > hangul && kana > cjk * 0.3) return "ja";
  if (hangul > kana && hangul > cjk * 0.3) return "ko";
  return "zh";
}

/** Strip LRC timestamps and metadata tags; return one plain line per lyric. */
function stripLrcTimestamps(lrc: string): string[] {
  return lrc
    .split("\n")
    .map(line => line.replace(/^\[[\d:.]+\]/, "").trim())
    .filter(line => line && !/^\[(?:ti|ar|al|by|offset|length):/.test(line));
}

/** Format a fractional-seconds value as an LRC timestamp [mm:ss.xx]. */
function toTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `[${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}]`;
}

/** Probe a single Python command/path; returns it if `--version` exits 0. */
function probePython(cmd: string): Promise<string | null> {
  return new Promise(resolve => {
    const child = spawn(cmd, ["--version"], { timeout: 5000 });
    child.on("close", code => resolve(code === 0 ? cmd : null));
    child.on("error", () => resolve(null));
  });
}

async function findPython(): Promise<string | null> {
  const names = process.platform === "win32" ? ["py", "python3", "python"] : ["python3", "python"];
  for (const name of names) {
    const found = await probePython(name);
    if (found) return found;
  }
  // Fall back to login shell on Unix (picks up Homebrew / pyenv / conda paths)
  if (process.platform !== "win32") {
    const shell = process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
    const shellPython = await new Promise<string | null>(resolve => {
      const child = spawn(shell, ["-ilc", "which python3 2>/dev/null || which python 2>/dev/null"], {
        timeout: 10000,
      });
      let stdout = "";
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.on("close", code => resolve(code === 0 ? stdout.trim().split("\n")[0]?.trim() || null : null));
      child.on("error", () => resolve(null));
    });
    if (shellPython) return shellPython;
  }
  return null;
}

/** Persistent cache directory for extracted vocals (keyed by audio URL hash). */
function vocalsCacheDir(): string {
  return path.join(app.getPath("userData"), "whisperx-vocals-cache");
}

function urlHash(url: string): string {
  return crypto.createHash("md5").update(url).digest("hex");
}

/**
 * Run demucs vocal separation via the SSL-patched wrapper script.
 * Returns the path to the extracted vocals.wav.
 */
function runDemucs(python: string, audioPath: string, outputDir: string): Promise<string> {
  const stem = path.basename(audioPath, path.extname(audioPath));
  return new Promise((resolve, reject) => {
    const args = [scriptPath("demucs_separate.py"), "--two-stems=vocals", "-o", outputDir, audioPath];
    log.info("[demucs] start:", args.join(" "));
    const child = spawn(python, args, { timeout: 600_000, env: sslEnv });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      const text = d.toString();
      stderr += text;
      for (const line of text.split("\n")) {
        if (line.trim()) log.info("[demucs]", line.trimEnd());
      }
    });
    child.on("close", code => {
      if (code === 0) {
        resolve(path.join(outputDir, "htdemucs", stem, "vocals.wav"));
      } else {
        const hint = stderr.includes("No module") ? " (请运行: pip install demucs)" : "";
        reject(new Error(`demucs 失败${hint}: ${stderr.slice(-400)}`));
      }
    });
    child.on("error", err => reject(new Error(`demucs 启动失败: ${err.message}`)));
  });
}

/**
 * Run the Python alignment script and parse its JSON output.
 * Returns an array of { start, text } segments.
 */
function runWhisperXAlign(
  python: string,
  vocalsPath: string,
  lyricsPath: string,
  language: string,
): Promise<Array<{ start: number; text: string }>> {
  return new Promise((resolve, reject) => {
    const alignScript = scriptPath("whisperx_align.py");
    log.info("[whisperx] start: language=" + language);
    const child = spawn(python, [alignScript, vocalsPath, lyricsPath, language], {
      timeout: 600_000,
      env: sslEnv,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => {
      const text = d.toString();
      stderr += text;
      for (const line of text.split("\n")) {
        if (line.trim()) log.info("[whisperx]", line.trimEnd());
      }
    });
    child.on("close", code => {
      if (code === 0 && stdout.trim()) {
        try {
          resolve(JSON.parse(stdout.trim()) as Array<{ start: number; text: string }>);
        } catch {
          log.error("[whisperx] stdout was not valid JSON:", stdout.slice(0, 200));
          reject(new Error("解析 whisperx 输出失败"));
        }
      } else {
        const hint =
          stderr.includes("No module") || stderr.includes("not installed")
            ? "请先安装依赖: pip install whisperx"
            : stderr.slice(-400) || "whisperx 对齐失败";
        reject(new Error(hint));
      }
    });
    child.on("error", err => reject(new Error(`whisperx 启动失败: ${err.message}`)));
  });
}

/** Cached Python path to avoid re-probing on every call. */
let cachedPython: string | null = null;

function checkModule(python: string, module: string): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn(python, ["-c", `import ${module}; print('ok')`], { timeout: 10000 });
    let stdout = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.on("close", code => resolve(code === 0 && stdout.trim() === "ok"));
    child.on("error", () => resolve(false));
  });
}

export async function checkWhisperXDeps(): Promise<{ ok: boolean; missingDep?: string; error?: string }> {
  const python = await findPython();
  if (!python) {
    return { ok: false, missingDep: "python", error: "Python 未安装，请先安装 Python 3" };
  }
  cachedPython = python;

  if (!(await checkModule(python, "demucs"))) {
    return { ok: false, missingDep: "demucs", error: "demucs 未安装" };
  }
  if (!(await checkModule(python, "whisperx"))) {
    return { ok: false, missingDep: "whisperx", error: "whisperx 未安装" };
  }
  return { ok: true };
}

export async function installWhisperXDeps(): Promise<{ ok: boolean; error?: string }> {
  const python = cachedPython ?? (await findPython());
  if (!python) {
    return { ok: false, error: "Python 未安装，无法自动安装依赖" };
  }
  cachedPython = python;

  function runPipInstall(py: string, extraArgs: string[], timeoutMs: number): Promise<{ ok: boolean; stderr: string }> {
    return new Promise(resolve => {
      const args = ["-m", "pip", "install", "demucs", "whisperx", ...extraArgs];
      log.info("[whisperx-deps] pip install:", py, args.join(" "));
      const child = spawn(py, args, { timeout: timeoutMs });
      let stderr = "";
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("close", (code: number | null) => resolve({ ok: code === 0, stderr }));
      child.on("error", (err: Error) => resolve({ ok: false, stderr: err.message }));
    });
  }

  const r1 = await runPipInstall(python, [], 600_000);
  if (r1.ok) return { ok: true };

  log.warn("[whisperx-deps] default PyPI failed, retrying with Tsinghua mirror...", r1.stderr);
  const r2 = await runPipInstall(
    python,
    ["-i", "https://pypi.tuna.tsinghua.edu.cn/simple", "--trusted-host", "pypi.tuna.tsinghua.edu.cn"],
    600_000,
  );
  if (r2.ok) return { ok: true };

  log.error("[whisperx-deps] pip install failed:", r2.stderr);
  return { ok: false, error: r2.stderr || "安装依赖失败，请检查网络连接后重试" };
}

/**
 * Full pipeline:
 *   1. Use local file or download Bilibili CDN audio (skipped if vocals already cached)
 *   2. demucs: extract vocals                        (skipped if vocals already cached)
 *   3. whisperx: transcribe + word-level align
 *   4. Map lyric lines to word timestamps
 *   5. Return synced LRC string
 */
export async function syncLyricsWithWhisperX(params: WhisperXSyncParams): Promise<string> {
  const { audioUrl, lrc, localFilePath } = params;

  const python = await findPython();
  if (!python) throw new Error("Python 未安装，请先安装 Python 3");

  // ── Vocals cache (keyed by local file path if provided, else audioUrl) ───
  const cacheKey = localFilePath ?? audioUrl;
  const cacheDir = path.join(vocalsCacheDir(), urlHash(cacheKey));
  const cachedVocals = path.join(cacheDir, "vocals.wav");

  // ── Strip LRC + detect language (needed regardless of cache) ─────────────
  const plainLines = stripLrcTimestamps(lrc);
  if (plainLines.length === 0) throw new Error("歌词内容为空");
  const language = params.language ?? detectLanguage(plainLines.join(" "));
  log.info("[whisperx-sync] Language:", language, "| Lines:", plainLines.length);

  let vocalsPath: string;

  if (fs.existsSync(cachedVocals)) {
    log.info("[whisperx-sync] Cache hit — skipping demucs:", cachedVocals);
    vocalsPath = cachedVocals;
  } else {
    const tmpDir = path.join(os.tmpdir(), `biu-whisperx-${Date.now()}`);
    await fsp.mkdir(tmpDir, { recursive: true });

    try {
      let audioPath: string;

      if (localFilePath) {
        // 1a. Use already-downloaded local file — skip CDN download
        log.info("[whisperx-sync] Using local file:", localFilePath);
        audioPath = localFilePath;
      } else {
        // 1b. Download audio from Bilibili CDN
        audioPath = path.join(tmpDir, "audio.m4a");
        log.info("[whisperx-sync] Downloading:", audioUrl.slice(0, 80));
        const cookie = await getCookieString();
        await pipeline(
          got.stream(audioUrl, {
            headers: {
              Cookie: cookie,
              Referer: "https://www.bilibili.com/",
              Origin: "https://www.bilibili.com",
              "User-Agent": UserAgent,
            },
          }),
          fs.createWriteStream(audioPath),
        );
      }

      // 2. Vocal separation via demucs
      const tmpVocals = await runDemucs(python, audioPath, tmpDir);

      // 3. Persist vocals to cache
      await fsp.mkdir(cacheDir, { recursive: true });
      await fsp.copyFile(tmpVocals, cachedVocals);
      log.info("[whisperx-sync] Vocals cached to:", cachedVocals);
      vocalsPath = cachedVocals;
    } finally {
      fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ── Transcribe + align ───────────────────────────────────────────────────
  const tmpLyrics = path.join(os.tmpdir(), `biu-lyrics-${Date.now()}.txt`);
  await fsp.writeFile(tmpLyrics, plainLines.join("\n"), "utf-8");
  try {
    const segments = await runWhisperXAlign(python, vocalsPath, tmpLyrics, language);
    if (segments.length === 0) throw new Error("对齐结果为空");
    return segments.map(seg => `${toTimestamp(seg.start)}${seg.text}`).join("\n");
  } finally {
    fsp.unlink(tmpLyrics).catch(() => {});
  }
}
