import { useCallback, useEffect, useRef, useState } from "react";

import {
  RiCloseLine,
  RiLockLine,
  RiLockUnlockLine,
  RiPauseLine,
  RiPlayLine,
  RiSkipBackLine,
  RiSkipForwardLine,
} from "@remixicon/react";

import type { LyricLine } from "@/store/lyrics-state";

import platform from "@/platform";

export const DESKTOP_LYRICS_CHANNEL = "biu-desktop-lyrics";

export interface DesktopLyricsMessage {
  type?: "update" | "request" | "cmd";
  lines?: LyricLine[];
  activeIndex?: number;
  // Duration of the current line in ms (next line's time - current line's time).
  lineDurationMs?: number;
  // How far we are into the current line at the moment this message was sent.
  // The window animates from this ratio using its own clock.
  lineElapsedMs?: number;
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
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [lineDurationMs, setLineDurationMs] = useState(0);
  const [lineElapsedMs, setLineElapsedMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  // Whether the cursor is currently inside the window while locked.
  // Drives visibility of the unlock button so it only appears on hover.
  const [cursorInsideLocked, setCursorInsideLocked] = useState(false);

  const bcRef = useRef<BroadcastChannel | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const unlockBtnRef = useRef<HTMLButtonElement>(null);

  // ── BroadcastChannel ──────────────────────────────────────────────────────
  useEffect(() => {
    const bc = new BroadcastChannel(DESKTOP_LYRICS_CHANNEL);
    bcRef.current = bc;
    bc.onmessage = (ev: MessageEvent<DesktopLyricsMessage>) => {
      const data = ev.data;
      if (data.type === "request" || data.type === "cmd") return;
      if (Array.isArray(data.lines)) setLines(data.lines);
      if (typeof data.activeIndex === "number") setActiveIndex(data.activeIndex);
      if (typeof data.lineDurationMs === "number") setLineDurationMs(data.lineDurationMs);
      if (typeof data.lineElapsedMs === "number") setLineElapsedMs(data.lineElapsedMs);
      if (typeof data.isPlaying === "boolean") setIsPlaying(data.isPlaying);
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

  const currentText = activeIndex >= 0 ? (lines[activeIndex]?.text ?? "") : "";
  const hasLyrics = currentText.length > 0;

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

  // ── List-scroll: keep the current line pinned at ~45% of the viewport ────
  // The entire list translates up when activeIndex advances. CSS transition
  // on `transform` makes the scroll smooth. Recomputed on window resize too
  // so the anchor point stays correct while the user is resizing.
  const scrollToCurrent = useCallback(
    (animated = true) => {
      const viewport = viewportRef.current;
      const list = listRef.current;
      if (!viewport || !list) return;
      const item = list.querySelector<HTMLElement>(`[data-lyric-index="${activeIndex}"]`);
      if (!item) return;
      const viewportH = viewport.clientHeight;
      // Anchor the active line a bit past the vertical center so it clears
      // the toolbar at top and still leaves room for the next line below.
      const targetY = viewportH * 0.55 - (item.offsetTop + item.offsetHeight / 2);
      list.style.transition = animated ? "transform 600ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
      list.style.transform = `translateY(${targetY}px)`;
    },
    [activeIndex],
  );

  useEffect(() => {
    scrollToCurrent(true);
  }, [scrollToCurrent]);

  useEffect(() => {
    const onResize = () => scrollToCurrent(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [scrollToCurrent]);

  // ── Karaoke progress driver ──────────────────────────────────────────────
  // The progress overlay fills left-to-right by animating CSS width with a
  // linear transition. Whenever the line (or play state) changes, we restart
  // the transition based on `lineElapsedMs / lineDurationMs`:
  //   • playing: snap to the elapsed ratio, then transition to 100% over the
  //     remaining duration
  //   • paused: snap to the elapsed ratio with no transition (progress halts)
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-lyric-index="${activeIndex}"] .progress`);
    if (!active) return;

    const duration = Math.max(0, lineDurationMs);
    const elapsed = Math.max(0, Math.min(lineElapsedMs, duration));
    const ratio = duration > 0 ? elapsed / duration : 0;

    active.style.transition = "none";
    active.style.width = `${ratio * 100}%`;
    // Force a reflow so the next transition starts from the snapped width.
    void active.offsetWidth;

    if (isPlaying && duration > 0) {
      const remaining = duration - elapsed;
      active.style.transition = `width ${remaining}ms linear`;
      active.style.width = "100%";
    }

    // Reset non-current progress bars so revisiting an earlier line starts clean.
    list.querySelectorAll<HTMLElement>(".progress").forEach(el => {
      if (el === active) return;
      el.style.transition = "none";
      el.style.width = "0%";
    });
  }, [activeIndex, lineDurationMs, lineElapsedMs, isPlaying, lines]);

  // ── Lock / unlock ─────────────────────────────────────────────────────────
  const applyIgnoreMouse = useCallback((ignore: boolean) => {
    platform.setDesktopLyricsIgnoreMouseEvents(ignore, { forward: true });
  }, []);

  const handleLock = useCallback(() => {
    // IMPORTANT: clear hover BEFORE setting locked — if reversed, the glass
    // background can get stuck because isLocked guard blocks the state clear.
    // 锁定只控制鼠标穿透，与置顶状态无关 —— 桌面歌词始终置顶（主进程 keep-alive 维护）。
    setIsHovered(false);
    setIsLocked(true);
    setCursorInsideLocked(false);
    applyIgnoreMouse(true);
  }, [applyIgnoreMouse]);

  const handleUnlock = useCallback(() => {
    setIsLocked(false);
    setCursorInsideLocked(false);
    setIsHovered(true); // cursor is still inside after clicking unlock
    applyIgnoreMouse(false);
  }, [applyIgnoreMouse]);

  // Locked state: poll cursor position via OS-level GetCursorPos through main IPC.
  //
  // Why polling instead of the forwarded `mousemove` event:
  // setIgnoreMouseEvents(true, { forward: true }) on Windows is unreliable when
  // the window also has WS_EX_NOACTIVATE (focusable: false) + WS_EX_TRANSPARENT —
  // mousemove events frequently get dropped, so the unlock button never appears.
  // OS-level GetCursorPos always works regardless of any window flags.
  //
  // 80ms polling is imperceptible to the user (12.5 fps for hover state is fine)
  // and the IPC overhead is negligible.
  useEffect(() => {
    if (!isLocked) return;
    let cancelled = false;
    const POLL_MS = 80;

    const tick = async () => {
      if (cancelled) return;
      const cursor = await platform.getDesktopLyricsCursorRelative();
      if (cancelled) return;

      if (!cursor) {
        // Cursor outside window → hide button, ensure click-through is on
        setCursorInsideLocked(false);
        applyIgnoreMouse(true);
        return;
      }

      setCursorInsideLocked(true);
      // If cursor is over the unlock button, temporarily disable click-through
      // so the button can receive the click. Otherwise keep events passing
      // through to apps below (LOL, WeGame, etc).
      const btn = unlockBtnRef.current;
      if (!btn) {
        applyIgnoreMouse(true);
        return;
      }
      const r = btn.getBoundingClientRect();
      const over = cursor.x >= r.left && cursor.x <= r.right && cursor.y >= r.top && cursor.y <= r.bottom;
      applyIgnoreMouse(!over);
    };

    const id = window.setInterval(tick, POLL_MS);
    void tick(); // run once immediately so the button responds without waiting a tick
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isLocked, applyIgnoreMouse]);

  // ── Resize ────────────────────────────────────────────────────────────────
  const handleResizeDragStart = useCallback(
    async (dir: ResizeDir, startX: number, startY: number) => {
      // Defensive: the handles aren't rendered when locked, but catch any
      // late-fired mousedown (e.g., lock-click race) before mutating bounds.
      if (isLocked) return;
      const bounds = await platform.getDesktopLyricsBounds();
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
        void platform.setDesktopLyricsBounds(next);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [isLocked],
  );

  // ── Window drag ───────────────────────────────────────────────────────────
  // We intentionally don't use `-webkit-app-region: drag` on the container:
  // drag regions swallow mousemove events at the OS level, so hover detection
  // only worked over the buttons and resize handles (the only `no-drag` zones).
  // Instead we implement dragging manually via IPC-driven setBounds — the
  // whole window now receives mousemove, which is what the hover-glass effect
  // relies on.
  const handleWindowDragStart = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (isLocked) return;
      const target = e.target as HTMLElement;
      // Don't start a drag when the user is clicking a button. Resize handles
      // already call stopPropagation, so their events never reach us.
      if (target.closest("button")) return;
      const bounds = await platform.getDesktopLyricsBounds();
      if (!bounds) return;
      const init = { ...bounds };
      const startX = e.screenX;
      const startY = e.screenY;
      const onMove = (ev: MouseEvent) => {
        void platform.setDesktopLyricsBounds({
          x: init.x + (ev.screenX - startX),
          y: init.y + (ev.screenY - startY),
          width: init.width,
          height: init.height,
        });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [isLocked],
  );

  const handleClose = () => platform.toggleDesktopLyrics();

  return (
    <>
      <style>{`
        /* Override HeroUI theme's body background so Electron transparent window works */
        html, body, #root {
          background: transparent !important;
          /* Second layer of safety: even if setIgnoreMouseEvents has a timing
             hiccup, the bare html/body don't capture clicks. Only the lyrics
             container (which sets pointer-events: auto via .biu-hit-area) does. */
          pointer-events: none;
        }

        /* The actual hittable surface — must explicitly opt-in to pointer events
           because the html/body chain above is none. */
        .biu-hit-area { pointer-events: auto; }

        #biu-lyrics-list {
          will-change: transform;
        }

        .lyric-item {
          display: flex;
          justify-content: center;
          align-items: center;
          text-align: center;
          white-space: nowrap;
          transition: opacity 500ms ease, transform 500ms ease;
        }

        .lyric-main {
          position: relative;
          font-weight: 800;
          line-height: 1.25;
          letter-spacing: 0.04em;
        }
        .lyric-main .base {
          color: rgba(255, 255, 255, 0.85);
          text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
        }
        .lyric-main .progress {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          overflow: hidden;
          white-space: nowrap;
          width: 0%;
          color: #a3e635;
          text-shadow:
            0 0 10px rgba(163, 230, 53, 0.55),
            0 1px 4px rgba(0, 0, 0, 0.6);
        }
      `}</style>

      {/*
        Outer container fills the Electron window (h-screen w-screen).
        Dragging is wired through onMouseDown → IPC setBounds (see
        handleWindowDragStart) instead of `-webkit-app-region: drag`, which
        swallows mouse events and breaks full-area hover detection.
      */}
      <div
        className="biu-hit-area relative h-screen w-screen overflow-hidden rounded-xl border transition-colors duration-300 select-none"
        style={{
          borderColor: isHovered && !isLocked ? "rgba(255,255,255,0.2)" : "transparent",
          background: isHovered && !isLocked ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.01)",
          backdropFilter: isHovered && !isLocked ? "blur(6px)" : "none",
          WebkitBackdropFilter: isHovered && !isLocked ? "blur(6px)" : "none",
        }}
        onMouseDown={handleWindowDragStart}
      >
        {/* Resize handles */}
        {!isLocked && RESIZE_DIRS.map(dir => <ResizeHandle key={dir} dir={dir} onDragStart={handleResizeDragStart} />)}

        {/* Normal toolbar */}
        <div
          className="absolute top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-1.5 shadow-lg transition-opacity duration-300"
          style={{
            opacity: isHovered && !isLocked ? 1 : 0,
            pointerEvents: isHovered && !isLocked ? "auto" : "none",
            background: "rgba(0,0,0,0.45)",
            border: "1px solid rgba(255,255,255,0.15)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <ToolBtn onClick={() => sendCmd("prev")} title="上一曲">
            <RiSkipBackLine size={16} />
          </ToolBtn>
          <ToolBtn onClick={() => sendCmd("toggle")} title={isPlaying ? "暂停" : "播放"}>
            {isPlaying ? <RiPauseLine size={18} /> : <RiPlayLine size={18} />}
          </ToolBtn>
          <ToolBtn onClick={() => sendCmd("next")} title="下一曲">
            <RiSkipForwardLine size={16} />
          </ToolBtn>

          <div style={{ width: 1, height: 12, margin: "0 2px", background: "rgba(255,255,255,0.3)" }} />

          <ToolBtn onClick={handleLock} title="锁定">
            <RiLockLine size={16} />
          </ToolBtn>
          <ToolBtn onClick={handleClose} title="关闭">
            <RiCloseLine size={16} />
          </ToolBtn>
        </div>

        {/* Locked toolbar — only visible when the cursor is inside the window */}
        <div
          className="absolute top-3 left-1/2 z-50 -translate-x-1/2 transition-opacity duration-200"
          style={{
            opacity: isLocked && cursorInsideLocked ? 1 : 0,
            pointerEvents: isLocked && cursorInsideLocked ? "auto" : "none",
          }}
        >
          <button
            ref={unlockBtnRef}
            type="button"
            onClick={handleUnlock}
            title="解锁桌面歌词"
            className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm text-white shadow-lg transition-colors duration-150"
            style={{
              background: "rgba(0,0,0,0.55)",
              border: "1px solid rgba(255,255,255,0.15)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(0,0,0,0.7)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(0,0,0,0.55)";
            }}
          >
            <RiLockUnlockLine size={14} />
            解锁桌面歌词
          </button>
        </div>

        {/*
          Lyrics viewport — the scrolling list lives inside. pointer-events:none
          so text never blocks the window drag region underneath.
          The list is absolutely positioned so translateY can move it freely
          without affecting layout of surrounding elements.
        */}
        <div ref={viewportRef} className="pointer-events-none absolute inset-0 overflow-hidden">
          {hasLyrics ? (
            <div ref={listRef} id="biu-lyrics-list" className="absolute right-0 left-0 flex flex-col items-center">
              {lines.map((lineObj, i) => {
                const offset = i - activeIndex;
                let opacity = 0;
                let scale = 0.8;
                let fontSize = "1.7rem";
                if (offset === 0) {
                  opacity = 1;
                  scale = 1;
                  fontSize = "2.4rem";
                } else if (offset === 1) {
                  opacity = 0.45;
                  scale = 0.85;
                  fontSize = "1.7rem";
                }
                return (
                  <div
                    key={i}
                    data-lyric-index={i}
                    className="lyric-item"
                    style={{ opacity, transform: `scale(${scale})` }}
                  >
                    <div className="lyric-main" style={{ fontSize }}>
                      <span className="base">{lineObj.text}</span>
                      <span className="progress">{lineObj.text}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <p
                className="font-bold whitespace-nowrap"
                style={{ fontSize: 24, lineHeight: 1.2, color: "rgba(255,255,255,0.2)" }}
              >
                暂无歌词
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default DesktopLyrics;
