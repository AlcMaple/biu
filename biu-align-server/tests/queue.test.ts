import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { WorkerOutput } from "../src/lib/result.js";

import { AlignmentCache, FailureCache } from "../src/lib/alignment-cache.js";
import { AlignError } from "../src/lib/errors.js";
import { AlignQueue, type JobOrigin, type QueueDeps } from "../src/lib/queue.js";

const page = { bvid: "BV13LFNzmEHG", cid: "1", title: "跳楼机", part: "", durationSec: 200 };
const goodOutput: WorkerOutput = {
  lang: "zh",
  lines: [{ text: "你好", chars: ["你", "好"], t: [1, 1.5], score: 0.4 }],
  offset: 0,
  frameMs: 20,
  timelineMatch: null,
};

async function setup(over: Partial<QueueDeps> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "biu-align-test-"));
  const release: (() => void)[] = [];
  const runWorker = vi.fn(
    () =>
      new Promise<WorkerOutput>(resolve => {
        release.push(() => resolve(goodOutput));
      }),
  );
  const deps: QueueDeps = {
    cache: new AlignmentCache(dir),
    failures: new FailureCache(dir),
    runWorker,
    getVideoPage: vi.fn(async () => page),
    downloadAudio: vi.fn(async () => {}),
    workDir: path.join(dir, "work"),
    ...over,
  };
  return { queue: new AlignQueue(deps), deps, release, runWorker };
}

const job = (mid: string, lyricsHash: string, origin: JobOrigin = "auto") => ({
  mid,
  origin,
  bvid: page.bvid,
  cid: "1",
  lyricsHash,
  lines: [{ t: 0, text: "你好" }],
});

const flush = () => new Promise(r => setTimeout(r, 20));

describe("AlignQueue", () => {
  it("同时只跑一个；同一份歌词重复提交复用同一任务；完成后命中缓存不再排队", async () => {
    const { queue, release, runWorker } = await setup();
    const a = await queue.submit(job("1", "h1"));
    const again = await queue.submit(job("2", "h1"));
    expect(again.id).toBe(a.id);
    const b = await queue.submit(job("2", "h2"));
    await flush();
    expect(runWorker).toHaveBeenCalledTimes(1);
    expect(queue.get(b.id!)).toMatchObject({ state: "queued", position: 1 });

    release.shift()!();
    // 完成要落盘，固定等 20 ms 在机器忙时会偶发不够
    await vi.waitFor(() => expect(runWorker).toHaveBeenCalledTimes(2));
    expect(queue.get(a.id!).state).toBe("done");

    const cached = await queue.submit(job("3", "h1"));
    expect(cached).toMatchObject({ id: null, state: "done" });
    expect(cached.alignment?.lines[0].words.map(w => w.text)).toEqual(["你", "好"]);
  });

  it("不设上限：同一人可以排很多首；出队按人轮转，每人先跑最近点的那首", async () => {
    const { queue, release } = await setup();
    await queue.submit(job("0", "running"));
    await flush();
    const a1 = await queue.submit(job("A", "a1"));
    await new Promise(r => setTimeout(r, 2));
    const a2 = await queue.submit(job("A", "a2"));
    await new Promise(r => setTimeout(r, 2));
    const a3 = await queue.submit(job("A", "a3"));
    const b1 = await queue.submit(job("B", "b1"));
    // A 最近点的 a3 先，然后轮到 B，再回到 A 的更早的歌
    expect([a3, b1, a2, a1].map(v => queue.get(v.id!).position)).toEqual([1, 2, 3, 4]);
    release.shift()!();
    await flush();
    expect(queue.get(a3.id!).state).toBe("running");
  });

  it("管理员手动对齐插到队首，并跳过成功缓存重跑", async () => {
    const { queue, release, runWorker } = await setup();
    const first = await queue.submit(job("1", "h1"));
    await queue.submit(job("2", "h2"));
    const m = await queue.submit(job("900", "h3", "manual"));
    expect(queue.get(m.id!).position).toBe(1);
    await flush();
    release.shift()!();
    await flush();
    expect(queue.get(m.id!).state).toBe("running");
    release.shift()!();
    await flush();
    release.shift()!();
    await flush();
    expect(queue.get(first.id!).state).toBe("done");
    const rerun = await queue.submit(job("900", "h1", "manual"));
    expect(rerun.id).not.toBeNull();
    await flush();
    expect(runWorker).toHaveBeenCalledTimes(4);
  });

  it("歌词对不上记下来，后面的人直接拿到失败不再排队；服务器侧失败不记", async () => {
    let fail: AlignError = new AlignError("BILIBILI_RATE_LIMITED");
    const { queue } = await setup({
      getVideoPage: vi.fn(async () => {
        throw fail;
      }),
    });
    const a = await queue.submit(job("1", "h1"));
    await flush();
    expect(queue.get(a.id!).error?.code).toBe("BILIBILI_RATE_LIMITED");
    expect((await queue.submit(job("2", "h1"))).id).not.toBeNull();
    await flush();

    fail = new AlignError("LYRICS_MISMATCH");
    const b = await queue.submit(job("1", "h2"));
    await flush();
    expect(queue.get(b.id!).error?.code).toBe("LYRICS_MISMATCH");
    expect(await queue.submit(job("3", "h2"))).toMatchObject({
      id: null,
      state: "failed",
      error: { code: "LYRICS_MISMATCH" },
    });
    // 管理员手动对齐不吃这层记录，用来复查
    expect((await queue.submit(job("900", "h2", "manual"))).id).not.toBeNull();
  });

  it("自动对齐成功后回调，带上来源", async () => {
    const onAligned = vi.fn(async () => {});
    const { queue, release } = await setup({ onAligned });
    await queue.submit(job("1", "h1"));
    await flush();
    release.shift()!();
    await flush();
    expect(onAligned).toHaveBeenCalledWith(expect.objectContaining({ origin: "auto", lyricsHash: "h1" }));
  });

  it("查不到的任务给 JOB_NOT_FOUND", async () => {
    const { queue } = await setup();
    expect(() => queue.get("nope")).toThrow(AlignError);
  });
});
