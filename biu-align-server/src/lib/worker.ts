import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LyricLine } from "./lyrics.js";
import type { WorkerOutput } from "./result.js";

import { config } from "./config.js";
import { AlignError, isAlignErrorCode } from "./errors.js";
import { readJson } from "./json-file.js";

// src/lib 和 dist/lib 都在包根下两层
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../worker/align.py");

export type RunWorker = (audio: string, lines: LyricLine[], workdir: string) => Promise<WorkerOutput>;

export const runWorker: RunWorker = async (audio, lines, workdir) => {
  const lyricsFile = path.join(workdir, "lyrics.json");
  const outFile = path.join(workdir, "out.json");
  await writeFile(
    lyricsFile,
    JSON.stringify(lines.map(l => ({ t: l.t, text: l.tag ? l.text.slice(l.tag.length) : l.text }))),
  );
  const stderr: string[] = [];
  const code = await new Promise<number | "timeout">((resolve, reject) => {
    const child = spawn(config.pythonBin, [SCRIPT, audio, lyricsFile, outFile, workdir], {
      stdio: ["ignore", "ignore", "pipe"],
      // 模型权重缓存在部署用户的 ~/.cache/torch，worker 继承同一个 HOME
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve("timeout");
    }, config.jobTimeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr.push(chunk);
      if (stderr.length > 200) stderr.shift();
    });
    child.on("error", err => {
      clearTimeout(timer);
      reject(new AlignError("ALIGN_FAILED", `无法启动 ${config.pythonBin}：${err.message}`));
    });
    child.on("close", exitCode => {
      clearTimeout(timer);
      resolve(exitCode ?? 1);
    });
  });
  if (code === "timeout") throw new AlignError("ALIGN_TIMEOUT");
  if (code !== 0) {
    const text = stderr.join("");
    const m = /ALIGN_ERROR (\w+) ?(.*)/.exec(text);
    if (m && isAlignErrorCode(m[1])) throw new AlignError(m[1], m[2]);
    // 未分类的崩溃把 stderr 尾部带进日志，否则线上只剩一句「对齐出错」，没法排查
    throw new AlignError("ALIGN_FAILED", `worker 退出码 ${code}：${text.trim().split("\n").slice(-5).join(" | ")}`);
  }
  const out = await readJson<WorkerOutput>(outFile);
  if (!out?.lines) throw new AlignError("ALIGN_FAILED", "worker 没有写出结果");
  return out;
};
