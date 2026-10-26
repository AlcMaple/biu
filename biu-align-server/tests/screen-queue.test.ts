import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { ScreenOutput } from "../src/lib/screen-worker.js";

import { AlignError } from "../src/lib/errors.js";
import { RecognizedStore } from "../src/lib/recognized.js";
import { ScreenQueue, type ScreenQueueDeps, toLrc } from "../src/lib/screen-queue.js";

const page = { bvid: "BV1At411L7cr", cid: "1", title: "搞cp抄", part: "", durationSec: 200 };
const SUB = [{ from: 1, to: 2, content: "一" }];
const lines = [
  { t: 1, text: "一" },
  { t: 2.5, text: "二" },
  { t: 61.234, text: "三" },
];

async function setup(over: Partial<ScreenQueueDeps> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "biu-screen-test-"));
  const release: ((out: ScreenOutput | Error) => void)[] = [];
  const runScreen = vi.fn(
    () =>
      new Promise<ScreenOutput>((resolve, reject) => {
        release.push(out => (out instanceof Error ? reject(out) : resolve(out)));
      }),
  );
  const recognized = new RecognizedStore(dir);
  const deps: ScreenQueueDeps = {
    recognized,
    runScreen,
    getVideoPage: vi.fn(async () => page),
    downloadVideo: vi.fn(async () => {}),
    workDir: path.join(dir, "work"),
    ...over,
  };
  return { queue: new ScreenQueue(deps), recognized, release, runScreen };
}

const job = (mid: string, cid = "1", v = 4) => ({ mid, bvid: page.bvid, cid, v, subtitle: SUB });
const flush = () => new Promise(r => setTimeout(r, 20));

describe("ScreenQueue", () => {
  it("同一视频只排一次；单并发，别的视频排在后面", async () => {
    const { queue, release, runScreen } = await setup();
    const a = await queue.submit(job("1"));
    expect((await queue.submit(job("2"))).id).toBe(a.id);
    const b = await queue.submit(job("2", "2"));
    await flush();
    expect(runScreen).toHaveBeenCalledTimes(1);
    expect(queue.get(b.id!)).toMatchObject({ state: "queued", position: 1 });
    release.shift()!({ from: "screen", lines, confident: true });
    await vi.waitFor(() => expect(runScreen).toHaveBeenCalledTimes(2));
    expect(queue.get(a.id!).state).toBe("done");
  });

  it("画面结果写进已识别歌词，带来源和吻合度；同版本再提交直接 done，更高版本重跑", async () => {
    const { queue, recognized, release } = await setup();
    const a = await queue.submit(job("1"));
    await flush();
    release.shift()!({ from: "screen", lines, confident: false });
    await vi.waitFor(() => expect(queue.get(a.id!).state).toBe("done"));
    expect(await recognized.get(page.bvid, "1")).toEqual({
      recognized: { lyrics: toLrc(lines), tLyrics: null, from: "screen", confident: false },
      missingUntil: null,
      v: 4,
    });
    expect(await queue.submit(job("2"))).toEqual({ id: null, state: "done" });
    expect((await queue.submit(job("2", "1", 5))).id).not.toBeNull();
  });

  it("双语画面的中文翻译存成翻译歌词，时间跟着原文", async () => {
    const { queue, recognized, release } = await setup();
    const a = await queue.submit({ ...job("1"), subtitle: [] });
    await flush();
    release.shift()!({
      from: "screen",
      lines: [
        { t: 1, text: "I let you go", translation: "那时我放开了的手" },
        { t: 3, text: "Now.." },
        { t: 5, text: "Walked away", translation: "转过身只剩了保重" },
      ],
      confident: false,
    });
    await vi.waitFor(() => expect(queue.get(a.id!).state).toBe("done"));
    expect((await recognized.get(page.bvid, "1")).recognized).toEqual({
      lyrics: "[00:01.00]I let you go\n[00:03.00]Now..\n[00:05.00]Walked away",
      tLyrics: "[00:01.00]那时我放开了的手\n[00:05.00]转过身只剩了保重",
      from: "screen",
      confident: false,
    });
  });

  it("画面和字幕都没有歌词时记为查无歌词", async () => {
    const { queue, recognized, release } = await setup();
    const a = await queue.submit(job("1"));
    await flush();
    release.shift()!({ from: null, lines: [], confident: false });
    await vi.waitFor(() => expect(queue.get(a.id!).state).toBe("done"));
    const rec = await recognized.get(page.bvid, "1");
    expect(rec.recognized).toBeNull();
    expect(rec.missingUntil).toBeGreaterThan(Date.now());
  });

  it("失败如实给出原因、不写结果，下一次提交可以重新排队", async () => {
    const { queue, recognized } = await setup({
      downloadVideo: vi.fn(async () => {
        throw new AlignError("VIDEO_PCDN_ONLY");
      }),
    });
    const a = await queue.submit(job("1"));
    await vi.waitFor(() => expect(queue.get(a.id!).state).toBe("failed"));
    expect(queue.get(a.id!).error).toEqual({
      code: "VIDEO_PCDN_ONLY",
      message: "视频画面下载失败，暂时无法识别歌词。",
    });
    expect((await recognized.get(page.bvid, "1")).v).toBeNull();
    expect((await queue.submit(job("1"))).id).not.toBe(a.id);
  });

  it("LRC 时间格式", () => {
    expect(toLrc(lines)).toBe("[00:01.00]一\n[00:02.50]二\n[01:01.23]三");
  });
});
