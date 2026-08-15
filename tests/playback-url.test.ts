import { describe, expect, it } from "vitest";

import { isSamePlaybackUrl, normalizePlaybackUrl, sanitizePersistedPlaybackUrls } from "@/common/utils/playback-url";
import { BILIBILI_MEDIA_PROXY_PREFIX } from "@shared/bilibili-web-proxy";

const TOKEN_A = `${BILIBILI_MEDIA_PROXY_PREFIX}/${"a".repeat(43)}`;
const TOKEN_B = `${BILIBILI_MEDIA_PROXY_PREFIX}/${"b".repeat(43)}`;

describe("playback URL normalization", () => {
  it("treats an audio element absolute src as the same same-origin opaque URL", () => {
    const base = "https://biu.example/player";
    expect(normalizePlaybackUrl(TOKEN_A, base)).toBe(`https://biu.example${TOKEN_A}`);
    expect(isSamePlaybackUrl(`https://biu.example${TOKEN_A}`, TOKEN_A, base)).toBe(true);
    expect(isSamePlaybackUrl(`https://biu.example${TOKEN_A}`, TOKEN_B, base)).toBe(false);
  });

  it("strips process-local media tokens from persisted queue data", () => {
    const original = {
      audioUrl: TOKEN_A,
      audioUrlCandidates: [TOKEN_A, TOKEN_B],
      bvid: "BV1keep",
      id: "item-1",
      title: "keep metadata",
      videoUrl: TOKEN_B,
    };

    expect(sanitizePersistedPlaybackUrls(original)).toEqual({
      audioUrl: undefined,
      audioUrlCandidates: undefined,
      bvid: "BV1keep",
      id: "item-1",
      title: "keep metadata",
      videoUrl: undefined,
    });
  });

  it("retains desktop/native URLs because only opaque Web tokens are ephemeral", () => {
    const original = {
      audioUrl: "https://upos-sz-mirror08h.bilivideo.com/upgcxcode/audio.m4s?deadline=9999999999",
      audioUrlCandidates: ["https://example.test/backup.m4s"],
    };
    expect(sanitizePersistedPlaybackUrls(original)).toBe(original);
  });
});
