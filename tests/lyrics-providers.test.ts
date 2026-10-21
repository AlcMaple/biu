// @vitest-environment node

import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import {
  decodeKrc,
  getProviderLyrics,
  ProviderTransportError,
  searchProviderLyrics,
  type ProviderHttpRequest,
  type ProviderTransport,
} from "@shared/lyrics-providers";

const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];

function encodeKrc(text: string) {
  const payload = deflateSync(Buffer.from(text, "utf8")).map((byte, index) => byte ^ KRC_KEY[index % KRC_KEY.length]);
  return Buffer.concat([Buffer.from("krc1"), payload]).toString("base64");
}

function scripted(...responses: { status?: number; body: unknown }[]) {
  const requests: ProviderHttpRequest[] = [];
  const transport = vi.fn<ProviderTransport>(async request => {
    requests.push(request);
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return { status: next.status ?? 200, text: typeof next.body === "string" ? next.body : JSON.stringify(next.body) };
  });
  return { requests, transport };
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

describe("QQ", () => {
  it("非零业务码报成检索异常，而不是空结果", async () => {
    const { transport } = scripted({ body: { code: 0, req_0: { code: 2001, data: { body: { item_song: [] } } } } });
    const result = await searchProviderLyrics(transport, { provider: "qq", title: "不存在" });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: "business", code: 2001 }) });
  });

  it("搜索结果映射成候选，取词解出 base64 LRC 与译文", async () => {
    const { transport, requests } = scripted(
      {
        body: {
          code: 0,
          req_0: {
            code: 0,
            data: {
              body: {
                item_song: [
                  {
                    mid: "0039MnYb0qxYhV",
                    title: "晴天",
                    interval: 269,
                    singer: [{ name: "周杰伦" }],
                    album: { name: "叶惠美" },
                  },
                ],
              },
            },
          },
        },
      },
      { body: { code: 0, retcode: 0, lyric: b64("[00:01.00]故事的小黄花"), trans: b64("[00:01.00]译") } },
    );
    const search = await searchProviderLyrics(transport, { provider: "qq", title: "晴天", artist: "周杰伦" });
    expect(search).toEqual({
      ok: true,
      data: [
        {
          provider: "qq",
          id: "0039MnYb0qxYhV",
          title: "晴天",
          artists: ["周杰伦"],
          album: "叶惠美",
          durationMs: 269_000,
          timing: "line",
        },
      ],
    });
    expect((JSON.parse(requests[0].body!) as { req_0: { param: { query: string } } }).req_0.param.query).toBe(
      "晴天 周杰伦",
    );

    const got = await getProviderLyrics(transport, { provider: "qq", id: "0039MnYb0qxYhV" });
    expect(got.ok && got.data.lyrics.lines[0]).toMatchObject({ text: "故事的小黄花", translation: "译" });
  });
});

describe("酷狗", () => {
  it("签名与实测跑通的歌词候选请求一致（秒转毫秒、歌手 - 歌名关键词）", async () => {
    const { transport, requests } = scripted(
      { body: { status: 200, candidates: [{ id: "274944371", accesskey: "AK", nickname: "作者" }] } },
      { body: { status: 200, content: encodeKrc("[1000,500]<0,500,0>晴") } },
    );
    const result = await getProviderLyrics(transport, {
      provider: "kugou",
      id: "B3A52A7A958BF0AED0EBFBA2E9A818B7",
      durationMs: 269_000,
      title: "晴天",
      artist: "周杰伦",
    });
    expect(requests[0].url.searchParams.get("signature")).toBe("7d98e4ba235c2d3fab74848b46f2ca54");
    expect(requests[1].url.searchParams.get("accesskey")).toBe("AK");
    expect(result).toEqual({
      ok: true,
      data: {
        provider: "kugou",
        sourceId: "274944371",
        author: "作者",
        lyrics: expect.objectContaining({ format: "krc", timing: "word" }),
      },
    });
  });

  it("没有歌词候选时报未收录，不继续下载", async () => {
    const { transport, requests } = scripted({ body: { status: 200, candidates: [] } });
    const result = await getProviderLyrics(transport, {
      provider: "kugou",
      id: "B3A52A7A958BF0AED0EBFBA2E9A818B7",
      durationMs: 1000,
    });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: "not_found" }) });
    expect(requests).toHaveLength(1);
  });

  it("HTTP 200 但正文为空不当成有歌词", async () => {
    const { transport } = scripted({ body: "" });
    const result = await searchProviderLyrics(transport, { provider: "kugou", title: "晴天" });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: "invalid_response" }) });
  });

  it("拒绝错误文件头和损坏的压缩体", async () => {
    await expect(decodeKrc(Buffer.from("nope1234").toString("base64"))).rejects.toThrow();
    await expect(
      decodeKrc(Buffer.concat([Buffer.from("krc1"), Buffer.from([1, 2, 3])]).toString("base64")),
    ).rejects.toThrow();
    await expect(decodeKrc(encodeKrc("[0,1]<0,1,0>a"))).resolves.toBe("[0,1]<0,1,0>a");
  });
});

describe("AMLL", () => {
  it("超出安全整数精度的 ID 按字符串保留", async () => {
    const { transport } = scripted({
      body: '{"status":200,"data":{"items":[{"id":90071992547409931,"musicNames":["晴天"],"artistNames":["周杰伦"],"authorUsernames":["u"]}]}}',
    });
    const result = await searchProviderLyrics(transport, { provider: "amll", title: "晴天" });
    expect(result.ok && result.data[0]).toMatchObject({ id: "90071992547409931", timing: "word", author: "u" });
  });

  it("404 报未收录，与服务故障分开", async () => {
    const { transport } = scripted({ status: 404, body: { status: 404 } });
    const result = await getProviderLyrics(transport, { provider: "amll", id: "1" });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: "not_found", status: 404 }) });
  });
});

describe("通用错误", () => {
  it.each([
    [429, "rate_limited"],
    [503, "upstream"],
  ])("HTTP %i → %s，只发一次请求", async (status, kind) => {
    const { transport } = scripted({ status, body: "" });
    const result = await searchProviderLyrics(transport, { provider: "amll", title: "晴天" });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind, status }) });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("超时如实报出", async () => {
    const transport: ProviderTransport = async () => {
      throw new ProviderTransportError("timeout");
    };
    const result = await searchProviderLyrics(transport, { provider: "qq", title: "晴天" });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: "timeout" }) });
  });

  it("不合法的来源和 ID 不发请求", async () => {
    const { transport } = scripted();
    expect(await searchProviderLyrics(transport, { provider: "x" as never, title: "a" })).toMatchObject({
      ok: false,
      error: { kind: "bad_request" },
    });
    expect(await getProviderLyrics(transport, { provider: "kugou", id: "../etc" })).toMatchObject({
      ok: false,
      error: { kind: "bad_request" },
    });
    expect(transport).not.toHaveBeenCalled();
  });
});
