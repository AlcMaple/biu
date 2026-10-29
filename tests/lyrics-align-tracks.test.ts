import { alignmentTrack, previewAlignment } from "@/components/lyrics/alignment";

const alignment = {
  lines: [
    {
      start: 10.2,
      text: "雨に濡れた小道",
      words: [],
      score: 1,
      translation: "雨后的小路",
      romanization: "Ame ni nureta",
    },
    { start: 14, text: "足跡攫う", words: [], score: 1, translation: "足迹" },
  ],
} as unknown as LyricsAlignment;

describe("对齐结果自带的译文 / 罗马音", () => {
  it("按对齐后的行时间分成译文和罗马音两轨", () => {
    expect(alignmentTrack(alignment.lines, "translation")).toEqual([
      { time: 10200, text: "雨后的小路" },
      { time: 14000, text: "足迹" },
    ]);
    expect(alignmentTrack(alignment.lines, "romanization")).toEqual([{ time: 10200, text: "Ame ni nureta" }]);
  });

  it("试听时优先用自带的译文，不再按文字搬旧译文", () => {
    const preview = previewAlignment(alignment, [], [{ time: 0, text: "旧译文" }]);
    expect(preview.translatedLyrics.map(l => l.text)).toEqual(["雨后的小路", "足迹"]);
    expect(preview.romanizedLyrics).toHaveLength(1);
  });
});
