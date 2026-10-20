import { useEffect, useRef } from "react";

import { type KaraokeTiming, wordProgress } from "./karaoke";

interface Props {
  timing: KaraokeTiming;
  // 主窗口按帧读 audio，桌面歌词窗按广播外推，时钟由调用方给
  subscribe: (onTick: (ms: number) => void) => () => void;
  baseClassName?: string;
}

// 每个字（拉丁文按词）叠两层：底层是原文，上层是同一段文字，按进度从左往右裁出来。和桌面歌词原来的整行填色同一套做法，
// 只是裁剪落到每个单元上，这样长句换行时也能逐行扫过去。
// 不用 background-clip: text 渐变：精美播放器当前行带 text-shadow，透明字色下阴影会盖住渐变。
// 每帧直接写 DOM 宽度，不走 React 渲染：60 fps 重渲整个歌词列表太贵
// 单元必须是 inline-block：绝对定位的填色层自己是块级，会按 line-height 加上半行距再排字；
// 若外层是普通 inline，它的盒子从字体 ascent 顶部起算、不含半行距，填色就比底字低约 0.19em，边缘出现重影。
// inline-block 让两层落在同一个行盒里，宽高与原来的字一致，不改变排版
const KaraokeText = ({ timing, subscribe, baseClassName }: Props) => {
  const fillRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(
    () =>
      subscribe(ms => {
        wordProgress(timing, ms).forEach((p, i) => {
          const el = fillRefs.current[i];
          if (el) el.style.width = `${(p * 100).toFixed(2)}%`;
        });
      }),
    [timing, subscribe],
  );

  return (
    <>
      {timing.words.map((word, i) => (
        <span key={`${word.time}-${i}`} className="relative inline-block whitespace-pre">
          <span className={baseClassName}>{word.text}</span>
          <span
            aria-hidden
            ref={node => {
              fillRefs.current[i] = node;
            }}
            className="karaoke-fill pointer-events-none absolute top-0 left-0 h-full overflow-hidden whitespace-pre select-none"
            style={{ width: 0 }}
          >
            {word.text}
          </span>
        </span>
      ))}
    </>
  );
};

export default KaraokeText;
