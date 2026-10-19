import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AlignmentCache } from "../src/lib/alignment-cache.js";
import { mockRunWorker } from "../src/lib/mock.js";
import { buildAlignment, looksMismatched } from "../src/lib/result.js";

const page = { bvid: "BV13LFNzmEHG", cid: "1", title: "t", part: "", durationSec: 200 };

describe("mock 模式", () => {
  it("带时间的歌词：整体推后 0.3 s、逐字递增且不越过下一行；不会被判成配错", async () => {
    const lines = [
      { t: 10, text: "你好，世界" },
      { t: 12, text: "baby 再见" },
    ];
    const out = await mockRunWorker(0)("", lines, "");
    expect(out.lines[0].t[0]).toBe(10.3);
    expect(out.lines[0].chars).toEqual([..."你好世界"]);
    for (const l of out.lines) expect([...l.t].sort((a, b) => a - b)).toEqual(l.t);
    expect(Math.max(...out.lines[0].t)).toBeLessThan(out.lines[1].t[0]);
    const a = buildAlignment({ ...page, lyricsHash: "h" }, page, lines, out);
    expect(a.lines[1].words.map(w => w.text)).toEqual(["baby ", "再", "见"]);
    expect(looksMismatched(a, true)).toBe(false);
  });

  it("纯文本歌词：每行 3 s 顺排", async () => {
    const out = await mockRunWorker(0)(
      "",
      [
        { t: 0, text: "一" },
        { t: 0, text: "二" },
      ],
      "",
    );
    expect(out.lines.map(l => l.t[0])).toEqual([5, 8]);
  });

  it("mock 结果和真实结果存在不同目录，切换模式互不可见", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "biu-align-mock-"));
    const out = await mockRunWorker(0)("", [{ t: 1, text: "你好" }], "");
    const a = buildAlignment({ ...page, lyricsHash: "h" }, page, [{ t: 1, text: "你好" }], out);
    await new AlignmentCache(dir, "mock").put("k", a);
    expect(await new AlignmentCache(dir).get("k")).toBeUndefined();
    expect(await new AlignmentCache(dir, "mock").get("k")).toBeTruthy();
  });

  it("NODE_ENV=production 下带 --mock 拒绝启动", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "--mock"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, NODE_ENV: "production", JWT_SECRET: "x", PORT: "0" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/mock/);
  });
});
