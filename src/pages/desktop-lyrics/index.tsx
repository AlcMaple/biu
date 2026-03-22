import { useCallback, useEffect, useRef, useState } from "react";

import {
  RiCloseLine,
  RiLockLine,
  RiLockUnlockLine,
  RiPauseLine,
  RiPlayLine,
  RiSkipBackLine,
  RiSkipForwardLine,
  RiText,
} from "@remixicon/react";

export const DESKTOP_LYRICS_CHANNEL = "biu-desktop-lyrics";

export interface DesktopLyricsMessage {
  type?: "update" | "request" | "cmd";
  line?: string;
  nextLine?: string;
  isPlaying?: boolean;
  cmd?: "prev" | "next" | "toggle";
}

// ─── Resize handles ───────────────────────────────────────────────────────────
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const CURSORS: Record<ResizeDir, string> = {
  n: "n-resize",
  s: "s-resize",
  e: "e-resize",
  w: "w-resize",
  ne: "ne-resize",
  nw: "nw-resize",
  se: "se-resize",
  sw: "sw-resize",
};

const ResizeHandle = ({
  dir,
  onDragStart,
}: {
  dir: ResizeDir;
  onDragStart: (dir: ResizeDir, sx: number, sy: number) => void;
}) => {
  const S = 8,
    C = 12;
  // window-no-drag: override the drag layer below so mousedown reaches our handler
  const style: React.CSSProperties = {
    position: "absolute",
    cursor: CURSORS[dir],
    zIndex: 100,
    appRegion: "no-drag",
  } as React.CSSProperties;
  if (dir === "n") Object.assign(style, { top: 0, left: C, right: C, height: S });
  if (dir === "s") Object.assign(style, { bottom: 0, left: C, right: C, height: S });
  if (dir === "e") Object.assign(style, { top: C, right: 0, bottom: C, width: S });
  if (dir === "w") Object.assign(style, { top: C, left: 0, bottom: C, width: S });
  if (dir === "ne") Object.assign(style, { top: 0, right: 0, width: C, height: C });
  if (dir === "nw") Object.assign(style, { top: 0, left: 0, width: C, height: C });
  if (dir === "se") Object.assign(style, { bottom: 0, right: 0, width: C, height: C });
  if (dir === "sw") Object.assign(style, { bottom: 0, left: 0, width: C, height: C });
  return (
    <div
      style={style}
      onMouseDown={e => {
        e.preventDefault();
        e.stopPropagation();
        onDragStart(dir, e.screenX, e.screenY);
      }}
    />
  );
};

const RESIZE_DIRS: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

// ─── Toolbar button ───────────────────────────────────────────────────────────
const ToolBtn = ({
  onClick,
  title,
  active,
  danger,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className="flex items-center justify-center rounded-full p-1.5 transition-all duration-150"
    style={{
      color: active ? "#1ed760" : "rgba(255,255,255,0.7)",
      background: active ? "rgba(30,215,96,0.18)" : "transparent",
    }}
    onMouseEnter={e => {
      const el = e.currentTarget;
      if (danger) {
        el.style.color = "#ff6b6b";
        el.style.background = "rgba(255,80,80,0.15)";
      } else if (active) {
        el.style.color = "#1ed760";
        el.style.background = "rgba(30,215,96,0.28)";
      } else {
        el.style.color = "#fff";
        el.style.background = "rgba(255,255,255,0.1)";
      }
    }}
    onMouseLeave={e => {
      const el = e.currentTarget;
      el.style.color = active ? "#1ed760" : "rgba(255,255,255,0.7)";
      el.style.background = active ? "rgba(30,215,96,0.18)" : "transparent";
    }}
  >
    {children}
  </button>
);

// ─── Main component ───────────────────────────────────────────────────────────
const DesktopLyrics = () => {
  const [line, setLine] = useState("");
  const [nextLine, setNextLine] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [dualLine, setDualLine] = useState(true);

  const bcRef = useRef<BroadcastChannel | null>(null);
  const safeAreaRef = useRef<HTMLDivElement>(null);
  const lyricsInnerRef = useRef<HTMLDivElement>(null);
  const unlockBtnRef = useRef<HTMLButtonElement>(null);

  // ── BroadcastChannel ──────────────────────────────────────────────────────
  useEffect(() => {
    const bc = new BroadcastChannel(DESKTOP_LYRICS_CHANNEL);
    bcRef.current = bc;
    bc.onmessage = (ev: MessageEvent<DesktopLyricsMessage>) => {
      if (ev.data.type === "request" || ev.data.type === "cmd") return;
      setLine(ev.data.line ?? "");
      setNextLine(ev.data.nextLine ?? "");
      setIsPlaying(ev.data.isPlaying ?? false);
    };
    bc.postMessage({ type: "request" });
    return () => {
      bc.close();
      bcRef.current = null;
    };
  }, []);

  const sendCmd = useCallback((cmd: "prev" | "next" | "toggle") => {
    bcRef.current?.postMessage({ type: "cmd", cmd });
  }, []);

  // ── Hover detection ───────────────────────────────────────────────────────
  //
  // onMouseEnter/Leave on app-region:drag elements is unreliable in Electron —
  // the drag region intercepts events and the parent never sees them.
  //
  // Instead:
  //   • window 'mousemove'  fires for ALL areas including drag regions
  //   • document.documentElement 'mouseleave' fires when cursor exits the window
  //
  // The effect re-subscribes when isLocked changes so we never update hover
  // state while locked (locked state has its own separate mousemove handler).
  useEffect(() => {
    if (isLocked) return;
    const onMove = () => setIsHovered(true);
    const onLeave = () => setIsHovered(false);
    window.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [isLocked]);

  // ── GPU-accelerated scale (transform: scale, NOT font-size) ──────────────
  //
  // offsetWidth/offsetHeight report the element's LAYOUT size — unaffected
  // by CSS transforms — so we can always measure the "natural" dimensions.
  const fitLyrics = useCallback(() => {
    const safe = safeAreaRef.current;
    const inner = lyricsInnerRef.current;
    if (!safe || !inner) return;
    const availW = safe.clientWidth;
    const availH = safe.clientHeight;
    const natW = inner.offsetWidth;
    const natH = inner.offsetHeight;
    if (!natW || !natH) return;
    // Dual-axis fit: min of width-ratio and height-ratio, capped at 1 (no upscale)
    // Floor at 0.35 so lyrics are always at least partially visible
    const s = Math.max(0.35, Math.min(availW / natW, availH / natH, 1));
    inner.style.transform = `scale(${s})`;
  }, []);

  // Re-fit when Electron resizes the native window (triggers DOM resize event)
  useEffect(() => {
    fitLyrics();
    window.addEventListener("resize", fitLyrics);
    return () => window.removeEventListener("resize", fitLyrics);
  }, [fitLyrics]);

  // Re-fit after content / dual-line changes (defer one tick for DOM update)
  useEffect(() => {
    const t = setTimeout(fitLyrics, 0);
    return () => clearTimeout(t);
  }, [line, nextLine, dualLine, fitLyrics]);

  // ── Lock / unlock ─────────────────────────────────────────────────────────
  const applyIgnoreMouse = useCallback((ignore: boolean) => {
    window.electron.setDesktopLyricsIgnoreMouseEvents(ignore, { forward: true });
  }, []);

  const handleLock = useCallback(() => {
    // IMPORTANT: clear hover BEFORE setting locked — if reversed, the glass
    // background can get stuck because isLocked guard blocks the state clear.
    setIsHovered(false);
    setIsLocked(true);
    applyIgnoreMouse(true);
    // Cursor is still inside the window at the moment of clicking lock,
    // so show the unlock button immediately without waiting for mousemove.
    if (unlockBtnRef.current) unlockBtnRef.current.style.opacity = "1";
  }, [applyIgnoreMouse]);

  const handleUnlock = useCallback(() => {
    setIsLocked(false);
    setIsHovered(true); // cursor is still inside after clicking unlock
    applyIgnoreMouse(false);
  }, [applyIgnoreMouse]);

  // Locked state: virtual hover detection.
  // CSS :hover is dead when setIgnoreMouseEvents is active, so we use mousemove
  // (forwarded by Electron via { forward: true }) + getBoundingClientRect to
  // decide whether to show the unlock button and pass clicks through.
  useEffect(() => {
    if (!isLocked) return;
    const onMouseMove = (e: MouseEvent) => {
      const btn = unlockBtnRef.current;
      if (!btn) {
        applyIgnoreMouse(true);
        return;
      }
      btn.style.opacity = "1";
      const r = btn.getBoundingClientRect();
      const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      applyIgnoreMouse(!over);
    };
    window.addEventListener("mousemove", onMouseMove);
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, [isLocked, applyIgnoreMouse]);

  // ── Resize ────────────────────────────────────────────────────────────────
  const handleResizeDragStart = useCallback(async (dir: ResizeDir, startX: number, startY: number) => {
    const bounds = await window.electron.getDesktopLyricsBounds();
    if (!bounds) return;
    const init = { ...bounds };
    const onMove = (e: MouseEvent) => {
      const dx = e.screenX - startX,
        dy = e.screenY - startY;
      const next = { ...init };
      if (dir.includes("e")) next.width = init.width + dx;
      if (dir.includes("s")) next.height = init.height + dy;
      if (dir.includes("w")) {
        next.x = init.x + dx;
        next.width = init.width - dx;
      }
      if (dir.includes("n")) {
        next.y = init.y + dy;
        next.height = init.height - dy;
      }
      void window.electron.setDesktopLyricsBounds(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const handleClose = () => window.electron.toggleDesktopLyrics();

  return (
    <>
      <style>{`
        /* Override HeroUI theme's body background so Electron transparent window works */
        html, body, #root { background: transparent !important; }

        @keyframes lyric-in {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .lyric-in { animation: lyric-in 0.22s ease both; }
      `}</style>

      {/*
        Outer container fills the Electron window (h-screen w-screen).
        window-drag enables Electron frameless window dragging.
        Pre-loaded transparent border prevents 1px layout jitter on hover.
      */}
      <div
        className="window-drag relative h-screen w-screen overflow-hidden rounded-xl border transition-all duration-300 select-none"
        style={{
          borderColor: isHovered && !isLocked ? "rgba(30,215,96,0.2)" : "transparent",
          // rgba(0,0,0,0.01): nearly invisible but non-zero alpha tells macOS to
          // deliver mouse events to this area even when the window is transparent.
          // Without this, transparent pixels are hit-test-ignored by the OS and
          // window.mousemove never fires outside the visible lyrics text.
          background: isHovered && !isLocked ? "rgba(30,215,96,0.08)" : "rgba(0,0,0,0.01)",
          backdropFilter: isHovered && !isLocked ? "blur(4px)" : "none",
          WebkitBackdropFilter: isHovered && !isLocked ? "blur(4px)" : "none",
          boxShadow: "none",
        }}
      >
        {/* Resize handles */}
        {!isLocked && RESIZE_DIRS.map(dir => <ResizeHandle key={dir} dir={dir} onDragStart={handleResizeDragStart} />)}

        {/*
          Normal toolbar — always mounted, visibility controlled by opacity so
          CSS transition works. pointerEvents:none when hidden so mouse passes
          through to the drag region underneath.
          window-no-drag overrides the parent drag region for button clicks.
        */}
        <div
          className="window-no-drag absolute top-2.5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full px-2 py-1 transition-all duration-300"
          style={{
            opacity: isHovered && !isLocked ? 1 : 0,
            pointerEvents: isHovered && !isLocked ? "auto" : "none",
            background: "rgba(10, 18, 12, 0.85)",
            border: "1px solid rgba(30,215,96,0.28)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(30,215,96,0.1)",
          }}
        >
          <ToolBtn onClick={() => sendCmd("prev")} title="上一曲">
            <RiSkipBackLine size={14} />
          </ToolBtn>
          <ToolBtn onClick={() => sendCmd("toggle")} title={isPlaying ? "暂停" : "播放"}>
            {isPlaying ? <RiPauseLine size={15} /> : <RiPlayLine size={15} />}
          </ToolBtn>
          <ToolBtn onClick={() => sendCmd("next")} title="下一曲">
            <RiSkipForwardLine size={14} />
          </ToolBtn>

          <div
            style={{
              width: 1,
              height: 11,
              margin: "0 3px",
              flexShrink: 0,
              background: "rgba(255,255,255,0.12)",
            }}
          />

          <ToolBtn
            onClick={() => {
              setDualLine(v => !v);
              setTimeout(fitLyrics, 0);
            }}
            title={dualLine ? "关闭双行" : "开启双行"}
            active={dualLine}
          >
            <RiText size={14} />
          </ToolBtn>
          <ToolBtn onClick={handleLock} title="锁定">
            <RiLockLine size={14} />
          </ToolBtn>
          <ToolBtn onClick={handleClose} title="关闭" danger>
            <RiCloseLine size={14} />
          </ToolBtn>
        </div>

        {/*
          Locked toolbar — same position as normal toolbar, always mounted.
          Contains only the unlock button.
        */}
        <div
          className="absolute top-2.5 left-1/2 z-50 -translate-x-1/2 transition-opacity duration-300"
          style={{
            opacity: isLocked ? 1 : 0,
            pointerEvents: isLocked ? "auto" : "none",
          }}
        >
          <button
            ref={unlockBtnRef}
            type="button"
            onClick={handleUnlock}
            title="解锁桌面歌词"
            className="window-no-drag flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold shadow-lg transition-colors duration-150"
            style={{
              background: "rgba(30,215,96,0.82)",
              color: "#fff",
              border: "1px solid rgba(30,215,96,0.55)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              pointerEvents: "auto",
              boxShadow: "0 2px 14px rgba(30,215,96,0.35)",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(30,215,96,0.95)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(30,215,96,0.82)";
            }}
          >
            <RiLockUnlockLine size={12} />
            解锁桌面歌词
          </button>
        </div>

        {/*
          Safe area — pointer-events-none so lyrics never block window dragging.
          paddingTop reserves space for the toolbar.
          The lyrics container uses transform-origin: top center so when the
          window grows vertically, lyrics stay anchored under the toolbar
          instead of drifting to the vertical center.
        */}
        <div
          ref={safeAreaRef}
          className="pointer-events-none absolute inset-0 flex justify-center"
          style={{ paddingTop: 52, paddingBottom: 10, paddingLeft: 20, paddingRight: 20 }}
        >
          <div className="flex h-full w-full flex-col items-center justify-start">
            <div
              ref={lyricsInnerRef}
              className="flex flex-col items-center"
              style={{ gap: 10, transformOrigin: "top center", willChange: "transform" }}
            >
              {line ? (
                <>
                  <p
                    key={line}
                    className="lyric-in font-extrabold tracking-wide whitespace-nowrap"
                    style={{
                      fontSize: 36,
                      lineHeight: 1.2,
                      background: "linear-gradient(90deg, #fff 10%, #9dffca 55%, #1ed760 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                      filter: "drop-shadow(0 2px 10px rgba(30,215,96,0.5))",
                    }}
                  >
                    {line}
                  </p>
                  {dualLine && nextLine && (
                    <p
                      key={nextLine}
                      className="lyric-in font-bold tracking-wide whitespace-nowrap"
                      style={{
                        fontSize: 22,
                        lineHeight: 1.2,
                        color: "rgba(30,215,96,0.52)",
                      }}
                    >
                      {nextLine}
                    </p>
                  )}
                </>
              ) : (
                <p
                  className="font-bold whitespace-nowrap"
                  style={{ fontSize: 24, lineHeight: 1.2, color: "rgba(255,255,255,0.18)" }}
                >
                  暂无歌词
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default DesktopLyrics;
