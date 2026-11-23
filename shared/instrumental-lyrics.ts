const timedTags = /\[(?:\d{1,3}:[^\]\r\n]*|\d+,\d+)\]|<\d+,\d+,\d+>/g;
const metadata = /^\[\s*[a-z][\w-]*\s*:[^\]]*\]$/i;
const credits =
  /^(?:作[词詞曲]|编曲|編曲|编[作]?词|演唱|词曲|唱|混音|制作人|录音|歌手|composer|lyricist|arranger|vocal(?:s)?)\s*:/i;
const instrumentalNotice =
  /^(?:(?:此|本)(?:歌曲|曲目|曲)(?:是|为|為)(?:(?:没有|沒有)填[词詞]的)?)?[纯純]音[乐樂](?:(?:请|請)(?:您)?欣[赏賞])?$|^instrumental(?:only)?$/i;

export function classifyLyricText(raw?: string | null): "instrumental" | "empty" | "text" {
  const lines = (raw ?? "")
    .split(/\r?\n/)
    .map(line => line.normalize("NFKC").replace(timedTags, "").trim())
    .filter(line => line && !metadata.test(line) && !credits.test(line));
  if (!lines.length) return "empty";
  // 整份只有明确提示才算纯音乐，避免把歌词正文里的「纯音乐」误当成曲目类型。
  return lines.every(line => instrumentalNotice.test(line.replace(/[\s\p{P}]/gu, ""))) ? "instrumental" : "text";
}
