import { useEffect, useRef, useState } from "react";

import { RiCloseLine } from "@remixicon/react";

export const DESKTOP_LYRICS_CHANNEL = "biu-desktop-lyrics";

export interface DesktopLyricsMessage {
  type?: "update" | "request";
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
      if (ev.data.type === "request") return;
      setLine(ev.data.line ?? "");
      setNextLine(ev.data.nextLine ?? "");
    };

    // Ask the main window to immediately push current lyrics state
    bc.postMessage({ type: "request", line: "", nextLine: "" });

    return () => {
      bc.close();
      bcRef.current = null;
    };
  }, []);

  const handleClose = () => {
    window.electron.toggleDesktopLyrics();
  };

  return (
    <>
      <style>{`
        @keyframes lyric-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .lyric-line { animation: lyric-in 0.25s ease; }
      `}</style>
      <div className="group window-drag relative flex h-screen w-screen items-end justify-center pb-3 select-none">
        <div
          className="window-no-drag relative mx-3 w-full overflow-hidden rounded-2xl px-6 py-3 text-center"
          style={{
            background: "rgba(10, 10, 18, 0.55)",
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 0 0 0.5px rgba(255,255,255,0.08)",
          }}
        >
          {/* Close button */}
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-2 right-2.5 rounded-full p-0.5 text-white/30 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white/80"
            title="关闭桌面歌词"
          >
            <RiCloseLine size={13} />
          </button>

          {line ? (
            <>
              <p
                key={line}
                className="lyric-line truncate leading-tight font-bold"
                style={{
                  fontSize: 22,
                  background: "linear-gradient(90deg, #fff 0%, #e8d9ff 60%, #c9b8ff 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  filter: "drop-shadow(0 2px 8px rgba(180,140,255,0.35))",
                }}
              >
                {line}
              </p>
              {nextLine && (
                <p
                  key={nextLine}
                  className="lyric-line mt-1.5 truncate leading-tight"
                  style={{ fontSize: 13, color: "rgba(255,255,255,0.38)" }}
                >
                  {nextLine}
                </p>
              )}
            </>
          ) : (
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.22)" }}>暂无歌词</p>
          )}
        </div>
      </div>
    </>
  );
};

export default DesktopLyrics;
