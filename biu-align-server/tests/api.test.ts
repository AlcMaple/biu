import type { AddressInfo } from "node:net";

import jwt from "jsonwebtoken";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { AlignmentCache, FailureCache } from "../src/lib/alignment-cache.js";
import { AlignQueue } from "../src/lib/queue.js";
import { RecognizedStore } from "../src/lib/recognized.js";
import { ReportStore } from "../src/lib/reports.js";
import { SubmissionStore } from "../src/lib/submissions.js";

const BV = "BV13LFNzmEHG";
const LYRICS = "[00:01.00]你好\n[00:02.00]世界";
const token = (mid: string) => jwt.sign({ mid }, "test-secret", { expiresIn: 600 });

let base = "";
let close: () => void;

beforeAll(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "biu-align-api-"));
  const cache = new AlignmentCache(dir);
  const failures = new FailureCache(dir);
  const submissions = new SubmissionStore(dir);
  const queue = new AlignQueue({
    cache,
    failures,
    runWorker: async (_audio, lines) => ({
      lang: "zh",
      lines: lines.map((l, i) => ({
        text: l.text,
        chars: [...l.text],
        t: [...l.text].map((_, k) => i * 2 + 1 + k * 0.3),
        score: 0.4,
      })),
      offset: 0,
      frameMs: 20,
      timelineMatch: null,
    }),
    getVideoPage: async (bvid, cid) => ({ bvid, cid, title: "测试投稿", part: "P1", durationSec: 200 }),
    downloadAudio: async () => {},
    workDir: path.join(dir, "work"),
    onAligned: async ({ origin, bvid, cid, lyricsHash }) => {
      if (origin === "auto") await submissions.publishIfEmpty({ bvid, cid, lyricsHash, source: "auto" });
    },
  });
  const server = createApp({
    queue,
    cache,
    failures,
    submissions,
    reports: new ReportStore(dir),
    recognized: new RecognizedStore(dir),
    rateLimitPerMinute: 1000,
  }).listen(0);
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

const PUBLIC_KEYS = [
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
].sort();

describe("自动对齐 → 所有人可用；上传 / 报错 → 管理员处理", () => {
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

  it("第一位听众自动对齐成功即对所有人生效；之后别的歌词不会顶掉它", async () => {
    const job = await call("POST", "/align/jobs", "1", { bvid: BV, cid: 1, lyrics: LYRICS });
    expect(job.status).toBe(202);
    const done = await waitDone(job.json.id, "1");
    expect(done.json.alignment.lines.map((l: any) => l.text)).toEqual(["你好", "世界"]);

    const pub = await call("GET", `/lyrics/${BV}/1`);
    // 公开接口只能有这些字段：不能带出提交者 mid、任务 id 等内部信息
    expect(Object.keys(pub.json.alignment).sort()).toEqual(PUBLIC_KEYS);
    expect(pub.json).toMatchObject({ source: "auto", alignment: { lyricsHash: done.json.alignment.lyricsHash } });

    const other = await call("POST", "/align/jobs", "2", {
      bvid: BV,
      cid: 1,
      lyrics: "[00:01.00]别的\n[00:02.00]歌词",
    });
    await waitDone(other.json.id, "2");
    expect((await call("GET", `/lyrics/${BV}/1`)).json.alignment.lyricsHash).toBe(done.json.alignment.lyricsHash);
  });

  it("上传：服务端代为对齐 → 打回带原因 → 重新上传 → 通过后替换当前版本", async () => {
    const lyrics = "你好呀\n世界";
    const sub = await call("POST", "/lyrics/submissions", "1", {
      bvid: BV,
      cid: 1,
      lyrics,
      title: "测试投稿",
      note: "修了第一句",
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

    const again = await call("POST", "/lyrics/submissions", "1", { bvid: BV, cid: 1, lyrics });
    let detail = await call("GET", `/admin/submissions/${again.json.id}`, "900");
    for (let i = 0; i < 50 && !detail.json.alignment; i++) {
      await new Promise(r => setTimeout(r, 10));
      detail = await call("GET", `/admin/submissions/${again.json.id}`, "900");
    }
    expect(detail.json.alignment.lines).toHaveLength(2);
    expect(detail.json.currentSource).toBe("auto");
    expect((await call("POST", `/admin/submissions/${again.json.id}/approve`, "900")).json.status).toBe("approved");
    expect((await call("POST", `/admin/submissions/${again.json.id}/approve`, "900")).json.error.code).toBe(
      "SUBMISSION_NOT_PENDING",
    );
    const pub = await call("GET", `/lyrics/${BV}/1`);
    expect(pub.json).toMatchObject({ source: "upload", alignment: { lyricsHash: detail.json.alignment.lyricsHash } });
    expect((await call("POST", "/lyrics/submissions", "2", { bvid: BV, cid: 1, lyrics })).json.error.code).toBe(
      "ALREADY_APPROVED",
    );
  });

  it("报错 → 确认并下线：下一位听众不会把这份自动对齐回来；管理员手动对齐后可重新发布", async () => {
    const cid = 2;
    const job = await call("POST", "/align/jobs", "1", { bvid: BV, cid, lyrics: LYRICS });
    const done = await waitDone(job.json.id, "1");
    const hash = done.json.alignment.lyricsHash;

    const rep = await call("POST", "/lyrics/reports", "3", { bvid: BV, cid, lyricsHash: hash, note: "整体慢半拍" });
    expect(rep.json).toMatchObject({ status: "pending", wasPublished: true, title: "测试投稿" });
    // 同一人重复报错只更新说明
    const dup = await call("POST", "/lyrics/reports", "3", { bvid: BV, cid, lyricsHash: hash, note: "慢一拍" });
    expect(dup.json.id).toBe(rep.json.id);
    expect((await call("GET", "/admin/reports", "900")).json.items).toHaveLength(1);
    expect((await call("GET", `/admin/reports/${rep.json.id}`, "900")).json.alignment.lyricsHash).toBe(hash);

    await call("POST", `/admin/reports/${rep.json.id}/resolve`, "900", { withdraw: true, reason: "已下线" });
    expect((await call("GET", `/lyrics/${BV}/${cid}`)).json.alignment).toBeNull();
    expect((await call("GET", "/lyrics/reports/mine", "3")).json.items[0]).toMatchObject({
      status: "resolved",
      withdrawn: true,
    });
    const next = await call("POST", "/align/jobs", "4", { bvid: BV, cid, lyrics: LYRICS });
    expect(next.json).toMatchObject({ id: null, state: "failed", error: { code: "ALIGNMENT_WITHDRAWN" } });

    // 普通用户的 manual 标记无效
    expect(
      (await call("POST", "/align/jobs", "4", { bvid: BV, cid, lyrics: LYRICS, manual: true })).json.id,
    ).toBeNull();
    const manual = await call("POST", "/align/jobs", "900", { bvid: BV, cid, lyrics: LYRICS, manual: true });
    await waitDone(manual.json.id, "900");
    expect((await call("GET", `/lyrics/${BV}/${cid}`)).json.alignment).toBeNull();
    expect((await call("POST", "/admin/published", "1", { bvid: BV, cid, lyrics: LYRICS })).json.error.code).toBe(
      "FORBIDDEN",
    );
    const pub = await call("POST", "/admin/published", "900", { bvid: BV, cid, lyrics: LYRICS });
    expect(pub.json).toMatchObject({ source: "admin", alignment: { lyricsHash: hash } });
    expect((await call("POST", "/align/jobs", "4", { bvid: BV, cid, lyrics: LYRICS })).json.state).toBe("done");
  });

  it("驳回报错必须写原因", async () => {
    const job = await call("POST", "/align/jobs", "1", { bvid: BV, cid: 3, lyrics: LYRICS });
    const done = await waitDone(job.json.id, "1");
    const rep = await call("POST", "/lyrics/reports", "3", {
      bvid: BV,
      cid: 3,
      lyricsHash: done.json.alignment.lyricsHash,
    });
    expect((await call("POST", `/admin/reports/${rep.json.id}/dismiss`, "900", {})).json.error.code).toBe(
      "REJECT_REASON_REQUIRED",
    );
    const r = await call("POST", `/admin/reports/${rep.json.id}/dismiss`, "900", { reason: "试听没问题" });
    expect(r.json).toMatchObject({ status: "dismissed", reason: "试听没问题" });
    expect(
      (await call("POST", "/lyrics/reports", "3", { bvid: BV, cid: 9, lyricsHash: "0123456789abcdef" })).json.error
        .code,
    ).toBe("ALIGNMENT_NOT_READY");
  });
});

describe("识别结果：登录用户写，所有人读", () => {
  const BV2 = "BV1xx411c7mD";
  const LRC = "[00:01.00]第一行\n[00:02.00]第二行\n[00:03.00]第三行";

  it("没有记录时返回空，匿名可读", async () => {
    const r = await call("GET", `/lyrics/${BV2}/1/recognized`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ recognized: null, missingUntil: null, v: null });
  });

  it("匿名不能写；歌词不足 3 行带时间、来源不对都拒绝", async () => {
    expect(
      (await call("POST", "/lyrics/recognized", undefined, { bvid: BV2, cid: 1, v: 3, lyrics: LRC, from: "qq" }))
        .status,
    ).toBe(401);
    const short = await call("POST", "/lyrics/recognized", "1", {
      bvid: BV2,
      cid: 1,
      v: 3,
      lyrics: "[00:01.00]一行",
      from: "qq",
    });
    expect(short.status).toBe(422);
    const plain = await call("POST", "/lyrics/recognized", "1", {
      bvid: BV2,
      cid: 1,
      v: 3,
      lyrics: "甲\n乙\n丙",
      from: "qq",
    });
    expect(plain.status).toBe(422);
    const from = await call("POST", "/lyrics/recognized", "1", { bvid: BV2, cid: 1, v: 3, lyrics: LRC, from: "x" });
    expect(from.status).toBe(400);
  });

  it("同版本先到先得，匿名读到的只有歌词字段；更高版本可以覆盖", async () => {
    const first = await call("POST", "/lyrics/recognized", "1", { bvid: BV2, cid: 1, v: 3, lyrics: LRC, from: "qq" });
    expect(first.json).toEqual({ stored: true });
    const second = await call("POST", "/lyrics/recognized", "2", {
      bvid: BV2,
      cid: 1,
      v: 3,
      lyrics: LRC.replace("第一行", "别的"),
      from: "kugou",
    });
    expect(second.json).toEqual({ stored: false });
    const read = await call("GET", `/lyrics/${BV2}/1/recognized`);
    expect(read.json).toEqual({ recognized: { lyrics: LRC, tLyrics: null, from: "qq" }, missingUntil: null, v: 3 });

    const upgraded = await call("POST", "/lyrics/recognized", "2", {
      bvid: BV2,
      cid: 1,
      v: 4,
      lyrics: LRC,
      from: "kugou",
    });
    expect(upgraded.json).toEqual({ stored: true });
    expect((await call("GET", `/lyrics/${BV2}/1/recognized`)).json.recognized.from).toBe("kugou");
  });

  it("「查无歌词」不会盖掉已有歌词；有效期内同版本不重复写", async () => {
    const BV3 = "BV1GJ411x7h7";
    const miss = await call("POST", "/lyrics/recognized", "1", { bvid: BV3, cid: 1, v: 3, missing: true });
    expect(miss.json).toEqual({ stored: true });
    const read = await call("GET", `/lyrics/${BV3}/1/recognized`);
    expect(read.json.missingUntil).toBeGreaterThan(Date.now());
    expect((await call("POST", "/lyrics/recognized", "2", { bvid: BV3, cid: 1, v: 3, missing: true })).json).toEqual({
      stored: false,
    });

    // 之后有人识别出了歌词，标记被歌词取代；再来「查无」不能盖回去
    await call("POST", "/lyrics/recognized", "2", { bvid: BV3, cid: 1, v: 3, lyrics: LRC, from: "lrclib" });
    expect((await call("GET", `/lyrics/${BV3}/1/recognized`)).json.missingUntil).toBeNull();
    expect((await call("POST", "/lyrics/recognized", "1", { bvid: BV3, cid: 1, v: 9, missing: true })).json).toEqual({
      stored: false,
    });
  });
});
