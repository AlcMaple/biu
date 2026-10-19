import type { AddressInfo } from "node:net";

import jwt from "jsonwebtoken";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { AlignmentCache } from "../src/lib/alignment-cache.js";
import { AlignQueue } from "../src/lib/queue.js";
import { SubmissionStore } from "../src/lib/submissions.js";

const BV = "BV13LFNzmEHG";
const LYRICS = "[00:01.00]你好\n[00:02.00]世界";
const token = (mid: string) => jwt.sign({ mid }, "test-secret", { expiresIn: 600 });

let base = "";
let close: () => void;

beforeAll(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "biu-align-api-"));
  const cache = new AlignmentCache(dir);
  const queue = new AlignQueue({
    cache,
    runWorker: async (_audio, lines) => ({
      lines: lines.map((l, i) => ({
        text: l.text,
        chars: [...l.text],
        t: [...l.text].map((_, k) => i * 2 + 1 + k * 0.3),
        score: 0.4,
      })),
      offset: 0,
      frameMs: 20,
    }),
    getVideoPage: async (bvid, cid) => ({ bvid, cid, title: "测试投稿", part: "P1", durationSec: 200 }),
    downloadAudio: async () => {},
    workDir: path.join(dir, "work"),
    queueMax: 5,
    dailyQuota: 5,
    isAdmin: mid => mid === "900",
  });
  const server = createApp({ queue, cache, submissions: new SubmissionStore(dir), rateLimitPerMinute: 1000 }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  close = () => server.close();
});

afterAll(() => close());

const call = async (method: string, p: string, mid?: string, body?: unknown) => {
  const res = await fetch(base + p, {
    method,
    headers: { "content-type": "application/json", ...(mid ? { authorization: `Bearer ${token(mid)}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    cache: res.headers.get("cache-control"),
    etag: res.headers.get("etag"),
    json: (await res.json()) as any,
  };
};

const waitDone = async (id: string, mid: string) => {
  for (let i = 0; i < 50; i++) {
    const r = await call("GET", `/align/jobs/${id}`, mid);
    if (r.json.state !== "queued" && r.json.state !== "running") return r;
    await new Promise(res => setTimeout(res, 10));
  }
  throw new Error("job did not finish");
};

describe("对齐 → 提交 → 审核 → 所有人可用", () => {
  it("未登录拒绝，错误带分类码和中文文案", async () => {
    const r = await call("POST", "/align/jobs", undefined, { bvid: BV, cid: 1, lyrics: LYRICS });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("UNAUTHORIZED");
    expect(r.json.error.message).toMatch(/登录/);
  });

  it("所有接口 no-store 且不带 ETag（避免轮询拿到 304 空 body）", async () => {
    const r = await call("GET", `/lyrics/${BV}/1`);
    expect(r.cache).toBe("no-store");
    expect(r.etag).toBeNull();
    expect(r.json.alignment).toBeNull();
  });

  it("没对齐过的歌词不能提交审核", async () => {
    const r = await call("POST", "/lyrics/submissions", "1", { bvid: BV, cid: 1, lyrics: "[00:01]别的歌词" });
    expect(r.json.error.code).toBe("ALIGNMENT_NOT_READY");
  });

  it("完整流程：打回带原因 → 重新提交 → 通过 → 匿名可读", async () => {
    const job = await call("POST", "/align/jobs", "1", { bvid: BV, cid: 1, lyrics: LYRICS });
    expect(job.status).toBe(202);
    const done = await waitDone(job.json.id, "1");
    expect(done.json.alignment.lines.map((l: any) => l.text)).toEqual(["你好", "世界"]);

    const sub = await call("POST", "/lyrics/submissions", "1", {
      bvid: BV,
      cid: 1,
      lyrics: LYRICS,
      note: "修了第二句",
    });
    expect(sub.status).toBe(201);
    expect(sub.json).toMatchObject({ status: "pending", title: "测试投稿", lineCount: 2 });

    expect((await call("GET", "/admin/submissions", "1")).json.error.code).toBe("FORBIDDEN");
    const pending = await call("GET", "/admin/submissions", "900");
    expect(pending.json.items.map((s: any) => s.id)).toEqual([sub.json.id]);

    expect(
      (await call("POST", `/admin/submissions/${sub.json.id}/reject`, "900", { reason: " " })).json.error.code,
    ).toBe("REJECT_REASON_REQUIRED");
    await call("POST", `/admin/submissions/${sub.json.id}/reject`, "900", { reason: "第二句时间不对" });
    const mine = await call("GET", "/lyrics/submissions/mine", "1");
    expect(mine.json.items[0]).toMatchObject({ status: "rejected", reason: "第二句时间不对" });

    const again = await call("POST", "/lyrics/submissions", "1", { bvid: BV, cid: 1, lyrics: LYRICS });
    const detail = await call("GET", `/admin/submissions/${again.json.id}`, "900");
    expect(detail.json.alignment.lines).toHaveLength(2);
    expect(detail.json.current).toBeNull();
    expect((await call("POST", `/admin/submissions/${again.json.id}/approve`, "900")).json.status).toBe("approved");
    expect((await call("POST", `/admin/submissions/${again.json.id}/approve`, "900")).json.error.code).toBe(
      "SUBMISSION_NOT_PENDING",
    );

    const pub = await call("GET", `/lyrics/${BV}/1`);
    // 公开接口只能有这些字段：不能带出提交者 mid、任务 id 等内部信息
    expect(Object.keys(pub.json.alignment).sort()).toEqual(
      [
        "alignerVersion",
        "bvid",
        "cid",
        "createdAt",
        "lines",
        "lrc",
        "lyricsHash",
        "offsetSec",
        "quality",
        "video",
      ].sort(),
    );
    expect(pub.json.alignment.lyricsHash).toBe(done.json.alignment.lyricsHash);
    expect((await call("POST", "/lyrics/submissions", "2", { bvid: BV, cid: 1, lyrics: LYRICS })).json.error.code).toBe(
      "ALREADY_APPROVED",
    );
  });

  it("新版本通过后旧版本变 superseded；同一人重复提交旧 pending 变 withdrawn", async () => {
    const lyrics = "[00:01.00]你好呀\n[00:02.00]世界";
    const job = await call("POST", "/align/jobs", "2", { bvid: BV, cid: 1, lyrics });
    await waitDone(job.json.id, "2");
    const s1 = await call("POST", "/lyrics/submissions", "2", { bvid: BV, cid: 1, lyrics });
    const s2 = await call("POST", "/lyrics/submissions", "2", { bvid: BV, cid: 1, lyrics });
    await call("POST", `/admin/submissions/${s2.json.id}/approve`, "900");
    const mine = (await call("GET", "/lyrics/submissions/mine", "2")).json.items;
    expect(mine.find((s: any) => s.id === s1.json.id).status).toBe("withdrawn");
    const all1 = (await call("GET", "/lyrics/submissions/mine", "1")).json.items;
    expect(all1.find((s: any) => s.status === "superseded")).toBeTruthy();
  });
});
