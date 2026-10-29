export const TRACK_LABEL: Record<AlignReportTrack, string> = {
  original: "原文时间轴",
  translation: "译文",
  romanization: "罗马音",
};

export const scopeText = (r: Pick<AlignReport, "track" | "fromLine" | "toLine">) => {
  const track = TRACK_LABEL[r.track ?? "original"];
  if (!r.fromLine || !r.toLine) return `${track} · 整首`;
  return r.fromLine === r.toLine ? `${track} · 第 ${r.fromLine} 行` : `${track} · 第 ${r.fromLine}–${r.toLine} 行`;
};
