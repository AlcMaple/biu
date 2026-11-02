export const TRACK_LABEL: Record<AlignReportTrack, string> = {
  original: "原文歌词",
  translation: "译文",
  romanization: "罗马音",
};

export const OTHER_TYPE_LABEL: Record<AlignReportOtherType, string> = {
  timeline: "歌词时间轴错误",
  lyrics: "歌词缺失/错误",
  instrumental: "纯音乐类型错误",
  title: "歌曲名/歌手名错误",
  audio: "音频错误",
  quality: "音质不佳",
  sensitive: "敏感内容",
  other: "其他",
};

export const OTHER_NOTE_MIN = 5;
export const OTHER_NOTE_MAX = 50;

// 中文歌只有原文，英 / 韩有译文，日语再加罗马音；语种不明（老缓存）时看实际有什么
const LANG_TRACKS: Record<string, AlignReportTrack[]> = {
  zh: ["original"],
  en: ["original", "translation"],
  ko: ["original", "translation"],
  ja: ["original", "translation", "romanization"],
};

export const reportTracks = (
  lang: "zh" | "ja" | "ko" | "en" | undefined,
  lines: Pick<AlignedLyricLine, "translation" | "romanization">[],
): AlignReportTrack[] =>
  (["original", "translation", "romanization"] as const).filter(
    track =>
      track === "original" ||
      (lines.some(l => l[track]) && (!lang || (LANG_TRACKS[lang] ?? LANG_TRACKS.zh).includes(track))),
  );

// 一行一句：没有这一轨的句子留空行，改的时候行号还能和原文对上
export const trackLines = (
  lines: Pick<AlignedLyricLine, "text" | "translation" | "romanization">[],
  track: AlignReportTrack,
) => lines.map(l => (track === "original" ? l.text : (l[track] ?? "")));

const lineKey = (value: string) =>
  value
    .split(/\r?\n/)
    .map(l => l.trimEnd())
    .join("\n")
    .trimEnd();

export const isCorrectionChanged = (original: string[], edited: string) => {
  const next = lineKey(edited);
  return Boolean(next) && next !== lineKey(original.join("\n"));
};

export const scopeText = (
  r: Pick<AlignReport, "track" | "fromLine" | "toLine" | "kind" | "otherType" | "corrected">,
) => {
  if (r.kind === "other" && r.otherType) return `其他错误 · ${OTHER_TYPE_LABEL[r.otherType]}`;
  const track = TRACK_LABEL[r.track ?? "original"];
  if (r.corrected) return `${track} · 附修改后的歌词`;
  if (!r.fromLine || !r.toLine) return `${track} · 整首`;
  return r.fromLine === r.toLine ? `${track} · 第 ${r.fromLine} 行` : `${track} · 第 ${r.fromLine}–${r.toLine} 行`;
};
