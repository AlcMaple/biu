import { describe, expect, it } from "vitest";

import { isShareCode, parseShareBody, ShareRequestError } from "../shares.js";

const online = { type: 2, rid: 1, bvid: "BV1xx411c7mD", title: "a", cover: "https://i0.hdslb.com/a.jpg" };

describe("parseShareBody", () => {
  it("keeps online items and drops local files and file:// covers", () => {
    const result = parseShareBody({
      folderId: 5,
      title: "我的歌单",
      cover: "file:///C:/Users/x/cover.jpg",
      items: [online, { type: 12, rid: "9", title: "local", source: "local", audioUrl: "file:///a.mp3" }, { type: 2, bvid: "../x", title: "bad" }],
    });
    expect(result.items).toHaveLength(1);
    expect(result.cover).toBeUndefined();
  });

  it("rejects playlists with nothing shareable", () => {
    expect(() => parseShareBody({ folderId: 5, title: "t", items: [{ type: 12, rid: 1, title: "x", source: "local" }] })).toThrow(
      ShareRequestError,
    );
  });

  it("validates share codes", () => {
    expect(isShareCode("abcDEF123_-")).toBe(true);
    expect(isShareCode("../etc/passwd")).toBe(false);
  });
});
