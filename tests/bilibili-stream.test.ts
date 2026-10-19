import { describe, expect, it } from "vitest";

import { collectStreamUrls, isPcdnUrl } from "@shared/bilibili-stream";

const UPOS = "https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/12/34/1234/1234-1-30280.m4s?e=x&os=cosbv&deadline=1";
const UPOS_BACKUP = "https://upos-sz-mirrorali.bilivideo.com/upgcxcode/12/34/1234/1234-1-30280.m4s?e=x&os=alibv";
const MCDN = "https://xy1x2x3x4xy.mcdn.bilivideo.cn:4483/upgcxcode/12/34/1234/1234-1-30280.m4s?e=x";
const SZBDYD = "https://abc.szbdyd.com/upgcxcode/12/34/1234/1234-1-30280.m4s?e=x";
const EDGE =
  "https://xxx.edge.mountaintoys.cn:4483/upgcxcode/12/34/1234/1234-1-30280.m4s?e=x&os=mcdn&oi=0&mcdnid=50062003&deadline=1";

describe("isPcdnUrl", () => {
  it("detects PCDN hosts by domain", () => {
    expect(isPcdnUrl(MCDN)).toBe(true);
    expect(isPcdnUrl(SZBDYD)).toBe(true);
  });

  it("detects PCDN nodes whose domain carries no mcdn hint", () => {
    expect(isPcdnUrl(EDGE)).toBe(true);
    expect(isPcdnUrl("https://a.example.cn/x.m4s?os=MCDN")).toBe(true);
    expect(isPcdnUrl("https://a.example.cn/x.m4s?mcdnid=1")).toBe(true);
  });

  it("does not flag regular upos sources", () => {
    expect(isPcdnUrl(UPOS)).toBe(false);
    expect(isPcdnUrl(UPOS_BACKUP)).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isPcdnUrl("")).toBe(false);
    expect(isPcdnUrl("not a url")).toBe(false);
  });
});

describe("collectStreamUrls", () => {
  it("puts regular sources first and keeps PCDN as fallback", () => {
    expect(collectStreamUrls(EDGE, [MCDN, UPOS, UPOS_BACKUP])).toEqual([UPOS, UPOS_BACKUP, EDGE, MCDN]);
  });

  it("dedupes and drops empty entries", () => {
    expect(collectStreamUrls(UPOS, [UPOS, "", SZBDYD])).toEqual([UPOS, SZBDYD]);
    expect(collectStreamUrls(undefined, undefined)).toEqual([]);
  });
});
