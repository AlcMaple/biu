import { beforeEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ data: {} as Record<string, MusicLyrics> }));

vi.mock("@/platform", () => ({
  default: {
    getStore: vi.fn(async () => store.data),
    setStore: vi.fn(async (_name: string, value: Record<string, MusicLyrics>) => {
      store.data = value;
    }),
  },
}));

import { adoptAlignment, restorePreAlign } from "@/components/lyrics/alignment";
import { buildProviderAdoption, linesOfEntry } from "@/components/lyrics/provider-lyrics";
import { parseKrcText } from "@shared/lyrics-format";

const KEY = "BV1xx411c7mD-1";
const adoption = buildProviderAdoption(
  { provider: "kugou", sourceId: "1", lyrics: parseKrcText("[1000,800]<0,300,0>晴<300,500,0>天") },
  { provider: "kugou", id: "H", title: "晴天", artists: ["周杰伦"] },
);
const alignment = {
  lyricsHash: "h",
  lines: [
    {
      start: 1.2,
      text: "晴天",
      score: 1,
      words: [
        { text: "晴", start: 1.2 },
        { text: "天", start: 1.6 },
      ],
    },
  ],
} as unknown as LyricsAlignment;

beforeEach(() => {
  store.data = { [KEY]: { ...adoption, source: "manual" } };
});

it("按当前录音对齐后优先显示对齐结果，来源元数据保留；还原后回到平台逐字时间", async () => {
  await adoptAlignment(KEY, alignment, "aligned");
  const aligned = store.data[KEY];
  expect(aligned.origin?.provider).toBe("kugou");
  expect(aligned.alignment).toBeDefined();
  // 对齐结果改写了 lyrics，平台逐字时间自动作废，不会和对齐结果混用
  expect(linesOfEntry(aligned)[0].nativeWords).toBeUndefined();

  const restored = await restorePreAlign(KEY);
  expect(restored?.lines[0]).toMatchObject({ time: 1000, nativeWords: true });
  expect(store.data[KEY].noAutoAlign).toBe(true);
});
