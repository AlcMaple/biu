import { useEffect, useRef, useState } from "react";

import { RiCloseLine } from "@remixicon/react";

export const DESKTOP_LYRICS_CHANNEL = "biu-desktop-lyrics";

export interface DesktopLyricsMessage {
  line: string;
  nextLine: string;
}

const DesktopLyrics = () => {
  const [line, setLine] = useState("");
  const [nextLine, setNextLine] = useState("");
  const bcRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const bc = new BroadcastChannel(DESKTOP_LYRICS_CHANNEL);
    bcRef.current = bc;
    bc.onmessage = (ev: MessageEvent<DesktopLyricsMessage>) => {
      setLine(ev.data.line ?? "");
      setNextLine(ev.data.nextLine ?? "");
    };
    return () => {
      bc.close();
      bcRef.current = null;
    };
  }, []);

  const handleClose = () => {
    window.electron.toggleDesktopLyrics();
  };

  return (
    <div className="group window-drag relative flex h-screen w-screen flex-col items-center justify-center select-none">
      <button
        type="button"
        onClick={handleClose}
        className="window-no-drag absolute top-1 right-2 rounded-full p-0.5 text-white/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
        title="关闭桌面歌词"
      >
        <RiCloseLine size={14} />
      </button>

      <div className="window-no-drag w-full px-6 text-center">
        {line ? (
          <>
            <p
              className="truncate leading-tight font-bold text-white"
              style={{ fontSize: 26, textShadow: "0 2px 12px rgba(0,0,0,0.95), 0 0 4px rgba(0,0,0,0.8)" }}
            >
              {line}
            </p>
            {nextLine && (
              <p
                className="mt-1 truncate text-white/55"
                style={{ fontSize: 15, textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}
              >
                {nextLine}
              </p>
            )}
          </>
        ) : (
          <p className="text-base text-white/30" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}>
            暂无歌词
          </p>
        )}
      </div>
    </div>
  );
};

export default DesktopLyrics;
