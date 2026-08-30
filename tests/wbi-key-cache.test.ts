import { beforeEach, describe, expect, it } from "vitest";

import {
  cacheWbiKeys,
  clearWbiKeyCache,
  extractWbiKeys,
  getCachedWbiKeys,
  getStaleWbiKeys,
  WBI_KEY_CACHE_TTL_MS,
} from "@/service/request/wbi-key-cache";

const image = {
  img_url: "https://i0.hdslb.com/bfs/wbi/image-key.png",
  sub_url: "https://i0.hdslb.com/bfs/wbi/sub-key.png",
};

describe("WBI key cache", () => {
  beforeEach(() => {
    clearWbiKeyCache();
  });

  it("extracts the filename keys from valid image URLs", () => {
    expect(extractWbiKeys(image)).toEqual({ img_key: "image-key", sub_key: "sub-key" });
  });

  it("rejects incomplete or malformed image metadata", () => {
    expect(extractWbiKeys({ img_url: image.img_url })).toBeUndefined();
    expect(extractWbiKeys({ img_url: "not a URL", sub_url: image.sub_url })).toBeUndefined();
  });

  it("serves fresh keys and exposes stale keys only for explicit fallback", () => {
    const now = 1_000;
    expect(cacheWbiKeys(image, now)).toEqual({ img_key: "image-key", sub_key: "sub-key" });
    expect(getCachedWbiKeys(now + WBI_KEY_CACHE_TTL_MS - 1)).toEqual({ img_key: "image-key", sub_key: "sub-key" });
    expect(getCachedWbiKeys(now + WBI_KEY_CACHE_TTL_MS)).toBeUndefined();
    expect(getStaleWbiKeys()).toEqual({ img_key: "image-key", sub_key: "sub-key" });
  });
});
