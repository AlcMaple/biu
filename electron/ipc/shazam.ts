import { desktopCapturer, ipcMain } from "electron";
import isDev from "electron-is-dev";
import log from "electron-log";
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { channel } from "./channel";

function getPythonScriptPath(): string {
  const base = isDev ? process.cwd() : process.resourcesPath;
  return path.join(base, "electron", "python", "shazam_recognize.py");
}

/** Probe a single command/path; resolves with it if `python --version` exits 0, else null. */
function probePython(cmd: string): Promise<string | null> {
  return new Promise(resolve => {
    const child = spawn(cmd, ["--version"], { timeout: 5000 });

    child.on("close", code => resolve(code === 0 ? cmd : null));
    child.on("error", () => resolve(null));
  });
}

/**
 * Ask the login shell for the real Python path.
 * Used as a fallback for GUI apps where the process PATH is stripped.
 *
 * NOTE: uses `-il` (interactive + login) so both .zprofile AND .zshrc are
 * sourced, picking up Homebrew / pyenv / conda regardless of where the user
 * added them.
 */
function findPythonFromShell(): Promise<string | null> {
  const shells = process.platform === "darwin" ? ["/bin/zsh", "/bin/bash"] : ["/bin/bash", "/bin/sh"];

  return new Promise(resolve => {
    let idx = 0;

    function tryNext() {
      if (idx >= shells.length) {
        resolve(null);
        return;
      }

      const shell = shells[idx++];
      // -i = interactive (sources .zshrc/.bashrc), -l = login (sources .zprofile)
      const child = spawn(shell, ["-ilc", "which python3 2>/dev/null || which python 2>/dev/null"], { timeout: 10000 });
      let stdout = "";

      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));

      child.on("close", code => {
        const found = stdout.trim().split("\n")[0]?.trim();

        if (code === 0 && found) {
          resolve(found);
        } else {
          tryNext();
        }
      });

      child.on("error", () => tryNext());
    }

    tryNext();
  });
}

/** Well-known absolute Python paths for macOS (covers Homebrew arm64/x64 and system Python). */
const MAC_PYTHON_PATHS = [
  "/opt/homebrew/bin/python3", // Homebrew Apple Silicon
  "/usr/local/bin/python3", // Homebrew Intel
  "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
  "/usr/bin/python3", // macOS system Python (stub on Ventura+, may be unusable)
];

/** Common absolute Python paths on Windows (py launcher + python.org + MS Store + conda/miniforge). */
function windowsPythonCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const programData = process.env.ProgramData ?? "C:\\ProgramData";
  const userHome = os.homedir();

  const versions = ["313", "312", "311", "310", "39"];
  const appDataPaths = versions.flatMap(v => [
    path.join(localAppData, "Programs", "Python", `Python${v}`, "python.exe"),
    path.join(localAppData, "Programs", "Python", `Python${v}-32`, "python.exe"),
  ]);

  // Conda / Miniconda / Miniforge base-env python (not in PATH when conda is not activated)
  const condaRoots = [
    path.join(userHome, "anaconda3"),
    path.join(userHome, "miniconda3"),
    path.join(userHome, "miniforge3"),
    path.join(userHome, "mambaforge"),
    path.join(userHome, "Anaconda3"),
    path.join(userHome, "Miniconda3"),
    path.join(localAppData, "anaconda3"),
    path.join(localAppData, "miniconda3"),
    path.join(localAppData, "miniforge3"),
    path.join(programData, "anaconda3"),
    path.join(programData, "miniconda3"),
    path.join(programData, "miniforge3"),
    "C:\\anaconda3",
    "C:\\miniconda3",
    "C:\\miniforge3",
    "C:\\ProgramData\\anaconda3",
    "C:\\ProgramData\\miniconda3",
  ];
  const condaPaths = condaRoots.map(r => path.join(r, "python.exe"));

  return [
    "py", // Python Launcher for Windows (most reliable)
    "python3",
    "python",
    path.join(localAppData, "Microsoft", "WindowsApps", "python3.exe"), // MS Store
    path.join(localAppData, "Microsoft", "WindowsApps", "python.exe"),
    ...appDataPaths,
    path.join(programFiles, "Python312", "python.exe"),
    path.join(programFilesX86, "Python312", "python.exe"),
    ...condaPaths,
  ];
}

async function findPython(): Promise<string | null> {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  // ── Step 1: current-process PATH ──────────────────────────────────────────
  // In dev mode (terminal launch) the Electron process inherits the shell's
  // full PATH, so this resolves immediately to the correct Python.
  // In GUI mode (DMG/installed app) PATH is stripped, so this will fail fast
  // (ENOENT) and we move on to the next step.
  const pathNames = isWin ? ["py", "python3", "python"] : ["python3", "python"];

  for (const name of pathNames) {
    const found = await probePython(name);
    if (found) return found;
  }

  // ── Step 2: interactive login shell ───────────────────────────────────────
  // For GUI apps where PATH is stripped. Uses -il so both .zprofile AND
  // .zshrc are sourced, finding Homebrew / pyenv / conda installs.
  if (!isWin) {
    const shellPython = await findPythonFromShell();
    if (shellPython) return shellPython;
  }

  // ── Step 3: well-known absolute paths ─────────────────────────────────────
  // Last-resort probe for common install locations.
  const absolutePaths = isWin ? windowsPythonCandidates() : isMac ? MAC_PYTHON_PATHS : [];

  for (const p of absolutePaths) {
    const found = await probePython(p);
    if (found) return found;
  }

  return null;
}

/** Cache the Python path found so installShazamio can reuse it without re-probing. */
let cachedPython: string | null = null;

export function registerShazamHandlers() {
  ipcMain.handle(channel.shazam.checkPython, async () => {
    const python = await findPython();

    if (!python) {
      return { ok: false, missingDep: "python", error: "Python 未安装，请先安装 Python 3" };
    }

    cachedPython = python;
    log.info("[shazam] found python:", python);

    return new Promise<{ ok: boolean; missingDep?: string; error?: string }>(resolve => {
      const child = spawn(python, ["-c", "import shazamio; print('ok')"], { timeout: 10000 });
      let stdout = "";

      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));

      child.on("close", code => {
        if (code === 0 && stdout.trim() === "ok") {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, missingDep: "shazamio", error: `ShazamIO 未安装，请运行: ${python} -m pip install shazamio` });
        }
      });

      child.on("error", err => resolve({ ok: false, error: err.message }));
    });
  });

  ipcMain.handle(channel.shazam.installShazamio, async () => {
    const python = cachedPython ?? (await findPython());

    if (!python) {
      return { ok: false, error: "Python 未安装，无法自动安装 ShazamIO" };
    }

    cachedPython = python;

    /** Run `py -m pip install shazamio [extraArgs]` and resolve with exit result. */
    function runPipInstall(py: string, extraArgs: string[], timeoutMs: number): Promise<{ ok: boolean; stderr: string }> {
      return new Promise(resolve => {
        const args = ["-m", "pip", "install", "shazamio", ...extraArgs];
        log.info("[shazam] pip install:", py, args.join(" "));
        const child = spawn(py, args, { timeout: timeoutMs });
        let stderr = "";

        child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("close", (code: number | null) => resolve({ ok: code === 0, stderr }));
        child.on("error", (err: Error) => resolve({ ok: false, stderr: err.message }));
      });
    }

    // Attempt 1: default PyPI (60 s) — works for users with direct PyPI access
    const r1 = await runPipInstall(python, [], 60000);
    if (r1.ok) return { ok: true };

    log.warn("[shazam] default PyPI failed, retrying with Tsinghua mirror...", r1.stderr);

    // Attempt 2: Tsinghua mirror (5 min) — fallback for mainland China users
    const r2 = await runPipInstall(
      python,
      ["-i", "https://pypi.tuna.tsinghua.edu.cn/simple", "--trusted-host", "pypi.tuna.tsinghua.edu.cn"],
      300000,
    );
    if (r2.ok) return { ok: true };

    log.error("[shazam] pip install shazamio failed:", r2.stderr);
    return { ok: false, error: r2.stderr || "安装 ShazamIO 失败，请检查网络连接后重试" };
  });

  ipcMain.handle(channel.shazam.recognize, async (_, audioBuffer: ArrayBuffer) => {
    const python = await findPython();

    if (!python) {
      return { error: "Python 未安装" };
    }

    const scriptPath = getPythonScriptPath();
    const tempFile = path.join(os.tmpdir(), `biu-shazam-${Date.now()}.webm`);

    try {
      await fsp.writeFile(tempFile, Buffer.from(audioBuffer));

      return await new Promise<Record<string, unknown>>(resolve => {
        const child = spawn(python, [scriptPath, tempFile], { timeout: 40000 });
        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

        child.on("close", code => {
          if (code === 0 && stdout.trim()) {
            try {
              resolve(JSON.parse(stdout.trim()) as Record<string, unknown>);
            } catch {
              resolve({ error: "解析识别结果失败" });
            }
          } else {
            log.error("[shazam] python stderr:", stderr);
            // Extract the actual error from stderr/stdout
            const errMsg = stderr.includes("not installed")
              ? "ShazamIO 未安装，请运行: pip install shazamio"
              : stderr || "识别失败";
            resolve({ error: errMsg });
          }
        });

        child.on("error", err => {
          log.error("[shazam] spawn error:", err);
          resolve({ error: err.message });
        });
      });
    } finally {
      fsp.unlink(tempFile).catch(() => {});
    }
  });

  ipcMain.handle(channel.shazam.getDesktopSources, async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      return sources.map(s => ({ id: s.id, name: s.name }));
    } catch (err) {
      log.error("[shazam] desktopCapturer error:", err);
      return [];
    }
  });
}
