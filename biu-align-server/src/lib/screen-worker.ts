import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LyricLine } from "./lyrics.js";

import { config } from "./config.js";
import { AlignError } from "./errors.js";
import { readJson } from "./json-file.js";

const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../worker");
// 部署前在 macOS 上用 `pnpm build:ocr` 编出来，随 release 一起拷贝（见 README）
const OCR_BIN = path.join(WORKER_DIR, "bin/ocr");
const SCRIPT = path.join(WORKER_DIR, "screen_lyrics.py");

export interface SubtitleLine {
  from: number;
  to: number;
  content: string;
}

// 双语画面（上行英文唱词、下行中文翻译）的中文挂在 translation 上，存成翻译歌词
export interface ScreenLine extends LyricLine {
  translation?: string;
}

export interface ScreenOutput {
  // null = 字幕是空的，画面和字幕都没有歌词
  from: "screen" | "subtitle" | null;
  lines: ScreenLine[];
  confident: boolean;
}

export type RunScreen = (video: string, subtitle: SubtitleLine[], workdir: string) => Promise<ScreenOutput>;

function run(bin: string, args: string[], deadline: number): Promise<{ code: number | "timeout"; stderr: string }> {
  return new Promise((resolve, reject) => {
    const stderr: string[] = [];
    const child = spawn(bin, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        resolve({ code: "timeout", stderr: stderr.join("") });
      },
      Math.max(0, deadline - Date.now()),
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr.push(chunk);
      if (stderr.length > 200) stderr.shift();
    });
    child.on("error", err => {
      clearTimeout(timer);
      reject(new AlignError("SCREEN_FAILED", `无法启动 ${bin}：${err.message}`));
    });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr: stderr.join("") });
    });
  });
}

const tail = (text: string) => text.trim().split("\n").slice(-5).join(" | ");

export const runScreen: RunScreen = async (video, subtitle, workdir) => {
  // 画面文字识别用的是 macOS 自带的 Vision；别的系统上直接说不支持，客户端退回用 AI 字幕原文
  if (process.platform !== "darwin") throw new AlignError("SCREEN_UNSUPPORTED");
  const deadline = Date.now() + config.jobTimeoutMs;
  const ocrFile = path.join(workdir, "ocr.jsonl");
  const subFile = path.join(workdir, "subtitle.json");
  const outFile = path.join(workdir, "screen.json");

  const ocr = await run(OCR_BIN, [video, ocrFile], deadline);
  if (ocr.code === "timeout") throw new AlignError("SCREEN_TIMEOUT");
  if (ocr.code !== 0) throw new AlignError("SCREEN_FAILED", `ocr 退出码 ${ocr.code}：${tail(ocr.stderr)}`);

  await writeFile(subFile, JSON.stringify(subtitle));
  const py = await run(config.pythonBin, [SCRIPT, ocrFile, subFile, outFile], deadline);
  if (py.code === "timeout") throw new AlignError("SCREEN_TIMEOUT");
  if (py.code !== 0) throw new AlignError("SCREEN_FAILED", `screen_lyrics 退出码 ${py.code}：${tail(py.stderr)}`);

  const out = await readJson<ScreenOutput>(outFile);
  if (!out?.lines) throw new AlignError("SCREEN_FAILED", "screen_lyrics 没有写出结果");
  return out;
};
