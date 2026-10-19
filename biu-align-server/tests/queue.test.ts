import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { WorkerOutput } from "../src/lib/result.js";

import { AlignmentCache } from "../src/lib/alignment-cache.js";
import { AlignError } from "../src/lib/errors.js";
import { AlignQueue, type QueueDeps } from "../src/lib/queue.js";

const page = { bvid: "BV13LFNzmEHG", cid: "1", title: "跳楼机", part: "", durationSec: 200 };
const goodOutput: WorkerOutput = {
  lines: [{ text: "你好", chars: ["你", "好"], t: [1, 1.5], score: 0.4 }],
  offset: 0,
  frameMs: 20,
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
    runWorker,
    getVideoPage: vi.fn(async () => page),
    downloadAudio: vi.fn(async () => {}),
    workDir: path.join(dir, "work"),
    queueMax: 2,
    dailyQuota: 2,
    isAdmin: mid => mid === "900",
    ...over,
  };
  return { queue: new AlignQueue(deps), deps, release, runWorker };
}

const job = (mid: string, lyricsHash: string) => ({
  mid,
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
    await flush();
    expect(queue.get(a.id!).state).toBe("done");
    expect(runWorker).toHaveBeenCalledTimes(2);

    const cached = await queue.submit(job("3", "h1"));
    expect(cached).toMatchObject({ id: null, state: "done" });
    expect(cached.alignment?.lines[0].words.map(w => w.text)).toEqual(["你", "好"]);
  });

  it("同一用户一次只能有一个进行中的任务；队列满拒绝", async () => {
    const { queue } = await setup({ queueMax: 1 });
    await queue.submit(job("1", "h1"));
    await flush();
    await expect(queue.submit(job("1", "h2"))).rejects.toMatchObject({ code: "JOB_BUSY" });
    await queue.submit(job("2", "h2"));
    await expect(queue.submit(job("3", "h3"))).rejects.toMatchObject({ code: "QUEUE_FULL" });
  });

  it("每日配额：服务端原因失败退还次数，用户侧原因不退；管理员不限", async () => {
    let fail: AlignError = new AlignError("BILIBILI_RATE_LIMITED");
    const { queue } = await setup({
      dailyQuota: 1,
      getVideoPage: vi.fn(async () => {
        throw fail;
      }),
    });
    const a = await queue.submit(job("1", "h1"));
    await flush();
    expect(queue.get(a.id!).error?.code).toBe("BILIBILI_RATE_LIMITED");
    fail = new AlignError("LYRICS_MISMATCH");
    const b = await queue.submit(job("1", "h2"));
    await flush();
    expect(queue.get(b.id!).error?.code).toBe("LYRICS_MISMATCH");
    await expect(queue.submit(job("1", "h3"))).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    for (const h of ["a", "b", "c"]) {
      const v = await queue.submit(job("900", h));
      await flush();
      expect(queue.get(v.id!).state).toBe("failed");
    }
  });

  it("查不到的任务给 JOB_NOT_FOUND", async () => {
    const { queue } = await setup();
    expect(() => queue.get("nope")).toThrow(AlignError);
  });
});
