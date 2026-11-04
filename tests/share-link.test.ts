import { buildFolderShareUrl, buildShareUrl, isValidBvid, parseShareParams } from "@/common/utils/share";

describe("share link", () => {
  it("builds hash link with cid and part", () => {
    expect(buildShareUrl({ bvid: "BV1xx411c7mD", cid: "123", pageIndex: 3 }, "https://music.alcmaple.cn")).toBe(
      "https://music.alcmaple.cn/#/share/BV1xx411c7mD?cid=123&p=3",
    );
  });

  it("omits query for single part and rejects bad bvid", () => {
    expect(buildShareUrl({ bvid: "BV1xx411c7mD" }, "https://a.b")).toBe("https://a.b/#/share/BV1xx411c7mD");
    expect(buildShareUrl({ bvid: "../etc" }, "https://a.b")).toBeUndefined();
    expect(isValidBvid(undefined)).toBe(false);
  });

  it("parses only numeric cid / p", () => {
    expect(parseShareParams("?cid=123&p=2")).toEqual({ cid: "123", pageIndex: 2 });
    expect(parseShareParams("?cid=abc&p=-1")).toEqual({ cid: undefined, pageIndex: undefined });
  });

  it("builds folder link and rejects bad id", () => {
    expect(buildFolderShareUrl(123456, "https://a.b")).toBe("https://a.b/#/share/folder/123456");
    expect(buildFolderShareUrl("../x", "https://a.b")).toBeUndefined();
    expect(buildFolderShareUrl(undefined, "https://a.b")).toBeUndefined();
  });
});
