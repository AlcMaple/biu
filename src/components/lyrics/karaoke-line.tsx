import { useEffect, useRef } from "react";

import { subscribePlaybackClock } from "./playback-clock";

// 最后一个字没有下一字可参照，按这么长填满，避免拖到下一行开始才填完
const LAST_WORD_MAX_MS = 1200;

interface Props {
  words: { text: string; time: number }[];
  /** 下一行开始时间（毫秒），没有就按 LAST_WORD_MAX_MS */
  endTime?: number;
  offset: number;
}

// 逐字点亮只改透明度（渐变裁剪会和歌词的 text-shadow 冲突），不动字号 / 字重 / 边距，避免行内文字跳动（AGENTS.md「UI / 样式」）。
// 每帧直接写 DOM 样式，不走 React 渲染：60 fps 重渲整个歌词列表太贵
const KaraokeLine = ({ words, endTime, offset }: Props) => {
  const spanRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(
    () =>
      subscribePlaybackClock(raw => {
        const ms = raw + offset;
        words.forEach((word, i) => {
          const el = spanRefs.current[i];
          if (!el) return;
          const next = words[i + 1]?.time ?? Math.min(endTime ?? Infinity, word.time + LAST_WORD_MAX_MS);
          const span = Math.max(1, next - word.time);
          const p = Math.min(1, Math.max(0, (ms - word.time) / span));
          el.style.opacity = (0.4 + 0.6 * p).toFixed(3);
        });
      }),
    [words, endTime, offset],
  );

  return (
    <>
      {words.map((word, i) => (
        <span
          key={`${word.time}-${i}`}
          ref={node => {
            spanRefs.current[i] = node;
          }}
          style={{ opacity: 0.4 }}
        >
          {word.text}
        </span>
      ))}
    </>
  );
};

export default KaraokeLine;
