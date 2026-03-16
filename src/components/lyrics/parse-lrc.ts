import type { LyricLine } from "@/store/lyrics-state";

const timeTagPattern = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;

export const parseLrc = (raw?: string | null): LyricLine[] => {
  if (!raw) return [];

  const result: LyricLine[] = [];
  const lines = raw.split(/\r?\n/);

  lines.forEach(line => {
    const text = line.replace(timeTagPattern, "").trim();
    if (!text) return;

    let match: RegExpExecArray | null;
    while ((match = timeTagPattern.exec(line)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const millis = match[3] ? Number(match[3].padEnd(3, "0")) : 0;

      if (Number.isNaN(minutes) || Number.isNaN(seconds) || Number.isNaN(millis)) continue;

      const time = Math.max(0, minutes * 60 * 1000 + seconds * 1000 + millis);
      result.push({ time, text });
    }

    timeTagPattern.lastIndex = 0;
  });

  return result.toSorted((a, b) => a.time - b.time);
};
