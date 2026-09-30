import { useEffect, useRef, useState } from "react";

import { addToast, Switch } from "@heroui/react";
import { RiHeart3Fill, RiHeart3Line, RiHeartPulseFill } from "@remixicon/react";

import { LIKED_FOLDER_ID, LIKED_FOLDER_TITLE } from "@/common/constants/heartbeat";
import { restoreSession, useHeartbeat } from "@/store/heartbeat";
import { useHeartbeatFx } from "@/store/heartbeat-fx";
import { type LocalFavItem, useLocalFavItemsStore } from "@/store/local-fav-items";
import { usePlayList } from "@/store/play-list";

import { NebulaCanvas, type NebulaApi } from "./nebula-canvas";

const EMPTY_LIKED_ITEMS: LocalFavItem[] = [];

const Heartbeat = () => {
  const loading = useHeartbeat(s => s.loading);
  const start = useHeartbeat(s => s.start);
  const toggleLikeCurrent = useHeartbeat(s => s.toggleLikeCurrent);

  const playId = usePlayList(s => s.playId);
  const list = usePlayList(s => s.list);
  const isPlaying = usePlayList(s => s.isPlaying);

  const current = list.find(i => i.id === playId);
  // Keep the selector result referentially stable when the folder has not been
  // hydrated yet. Returning a fresh [] on every render makes Zustand's
  // useSyncExternalStore loop forever on the FM route.
  const likedItems = useLocalFavItemsStore(s => s.folderItems[LIKED_FOLDER_ID] ?? EMPTY_LIKED_ITEMS);
  const isLiked = Boolean(current?.bvid) && likedItems.some(i => i.bvid === current?.bvid);

  const handleStart = async () => {
    const res = await start();
    if (res === "empty") {
      addToast({ title: `先往「${LIKED_FOLDER_TITLE}」加几首歌`, color: "warning" });
    } else if (res === "error") {
      addToast({ title: "启动失败，请稍后重试", color: "danger" });
    }
  };

  useEffect(() => {
    let cancelled = false;
    // 先等重启恢复跑完（幂等，与 PlayBar 共用同一个 promise），再判「接着放 / 重开」，
    // 否则冷启后极快点进 FM 可能抢在恢复 settle 之前，把可续播的会话误判成不在场而重开。
    void (async () => {
      await restoreSession();
      if (cancelled) return;
      // 会话还在场（切去别的歌单看了看又回来 / 重启恢复成功）：接着放，不重开一轮。
      // 只有「从未开始」或「已被点歌单整队替换掉」时才开新的一轮（打断当前播放）。
      if (useHeartbeat.getState().isSessionLive()) return;
      if (!useHeartbeat.getState().loading) void handleStart();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLike = () => {
    const r = toggleLikeCurrent();
    if (r === "added") addToast({ title: `已加入「${LIKED_FOLDER_TITLE}」`, color: "success" });
    else if (r === "removed") addToast({ title: `已移出「${LIKED_FOLDER_TITLE}」`, color: "default" });
  };

  const lite = useHeartbeatFx(st => st.lite);
  const setLite = useHeartbeatFx(st => st.setLite);
  const vinylRef = useRef<HTMLDivElement>(null);
  const nebulaRef = useRef<NebulaApi | null>(null);
  const [charge, setCharge] = useState(0);
  const holdRef = useRef<{ raf: number; start: number; fired: boolean } | null>(null);
  const HOLD_MS = 800;

  const endHold = () => {
    const h = holdRef.current;
    if (!h) return false;
    cancelAnimationFrame(h.raf);
    holdRef.current = null;
    setCharge(0);
    nebulaRef.current?.setCharge(0);
    return h.fired;
  };
  const startHold = () => {
    if (!current || holdRef.current) return;
    const h = { raf: 0, start: performance.now(), fired: false };
    holdRef.current = h;
    const tick = () => {
      const p = Math.min((performance.now() - h.start) / HOLD_MS, 1);
      setCharge(p);
      nebulaRef.current?.setCharge(p);
      if (p >= 1) {
        h.fired = true;
        nebulaRef.current?.burst();
        // 彩蛋：长按满格 = 收藏（已收藏则只放烟花，不取消）
        if (!isLiked) toggleLikeCurrent();
        setCharge(0);
        nebulaRef.current?.setCharge(0);
        cancelAnimationFrame(h.raf);
        return;
      }
      h.raf = requestAnimationFrame(tick);
    };
    h.raf = requestAnimationFrame(tick);
  };
  const releaseHold = () => {
    const fired = endHold();
    if (!fired && charge < 1) handleLike();
  };
  useEffect(() => () => void endHold(), []);

  const title = current ? current.pageTitle || current.title : "私人FM";
  const cover = current ? current.pageCover || current.cover : "";
  const owner = current?.customArtist || current?.ownerName || "";
  const spin = { animationPlayState: isPlaying ? "running" : "paused" } as const;
  const chars = Array.from(title);
  const R = 22;
  const C = 2 * Math.PI * R;

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-9 overflow-hidden p-8 select-none">
      <style>{`
        @keyframes fm-spin { to { transform: rotate(360deg); } }
        @keyframes fm-ripple { 0% { transform: scale(.85); opacity: .55; } 100% { transform: scale(1.75); opacity: 0; } }
        @keyframes fm-drift { 0%,100% { transform: translate3d(0,0,0) scale(1.25); } 50% { transform: translate3d(3%,-4%,0) scale(1.4); } }
        @keyframes fm-beat { 0%,100% { transform: scale(1); } 15% { transform: scale(1.28); } 30% { transform: scale(1); } 45% { transform: scale(1.16); } }
        @keyframes fm-char { 0% { opacity: 0; transform: translateY(0.6em) scale(.8); filter: blur(10px); } 100% { opacity: 1; transform: none; filter: blur(0); } }
        @keyframes fm-sheen { 0% { background-position: 200% 0; } 100% { background-position: -100% 0; } }
        @keyframes fm-heart-idle { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
      `}</style>

      {/* 氛围背景：封面高斯模糊铺底 */}
      {cover && (
        <img
          key={cover}
          src={cover}
          alt=""
          aria-hidden
          referrerPolicy="no-referrer"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40 blur-3xl saturate-150"
          style={{ animation: "fm-drift 14s ease-in-out infinite", ...spin }}
        />
      )}
      <div className="from-background/30 via-background/60 to-background pointer-events-none absolute inset-0 bg-gradient-to-b" />

      {/* 粒子星云：每首歌由 bvid 生成不同旋臂/方向/色相，低频驱动呼吸，高频驱动闪烁 */}
      <NebulaCanvas
        seed={current?.bvid ?? "biu"}
        cover={cover || ""}
        playing={isPlaying}
        lite={lite}
        anchorRef={vinylRef}
        apiRef={nebulaRef}
      />

      <div className="absolute top-4 right-5 z-10 flex items-center gap-2 text-xs text-zinc-400">
        <span>简化特效</span>
        <Switch size="sm" isSelected={lite} onValueChange={setLite} aria-label="简化特效" />
      </div>

      {/* 黑胶唱片 */}
      <div className="relative flex h-72 w-72 max-w-[70vw] items-center justify-center" style={{ maxHeight: "70vw" }}>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="border-primary/50 absolute inset-6 rounded-full border"
            style={{ animation: "fm-ripple 3.6s ease-out infinite", animationDelay: `${i * 1.2}s`, ...spin }}
          />
        ))}
        <div
          ref={vinylRef}
          className="relative h-56 w-56 rounded-full shadow-[0_20px_60px_-10px_rgba(0,0,0,0.7)]"
          style={{
            animation: "fm-spin 22s linear infinite",
            ...spin,
            background: "repeating-radial-gradient(circle at center, #0c0c0d 0, #0c0c0d 2px, #17171a 3px, #0c0c0d 4px)",
          }}
        >
          <div
            className="absolute inset-0 rounded-full opacity-40"
            style={{
              background:
                "conic-gradient(from 30deg, transparent 0 20%, rgba(255,255,255,.28) 27%, transparent 34% 70%, rgba(255,255,255,.2) 77%, transparent 84%)",
            }}
          />
          <div className="bg-content2 absolute inset-[27%] overflow-hidden rounded-full ring-4 ring-black/70">
            {cover ? (
              <img src={cover} alt={title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="text-primary flex h-full w-full items-center justify-center">
                <RiHeartPulseFill size={40} />
              </div>
            )}
          </div>
          <div className="absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/90" />
        </div>
      </div>

      <div className="relative flex max-w-2xl flex-col items-center gap-3 text-center">
        <div className="text-primary flex items-center gap-1.5 text-xs font-medium tracking-[0.3em]">
          <RiHeartPulseFill size={14} style={{ animation: "fm-beat 1.6s ease-in-out infinite", ...spin }} />
          PRIVATE FM
        </div>
        {/* 歌名：逐字模糊浮现，随后一道高光扫过；换歌重新入场 */}
        <div
          key={title}
          className="line-clamp-2 text-3xl leading-tight font-black tracking-wide text-balance"
          style={{
            backgroundImage: "linear-gradient(100deg, currentColor 40%, #fff 50%, currentColor 60%)",
            backgroundSize: "300% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            animation: "fm-sheen 4s ease-in-out 1.2s 1 both",
            textShadow: "0 0 30px rgba(255,255,255,0.15)",
          }}
        >
          {chars.map((ch, i) => (
            <span
              key={i}
              className="inline-block whitespace-pre text-zinc-100"
              style={{ animation: `fm-char .7s cubic-bezier(.2,.8,.2,1) ${Math.min(i * 45, 900)}ms both` }}
            >
              {ch}
            </span>
          ))}
        </div>
        <div className="text-sm tracking-widest text-zinc-400">{owner}</div>
      </div>

      {/* 收藏：点按 = 收藏/取消；长按蓄力到满 = 彩蛋（冲击波 + 红心流星雨 + 星云染粉） */}
      <div className="relative flex flex-col items-center gap-2">
        <button
          type="button"
          disabled={!current || loading}
          onPointerDown={startHold}
          onPointerUp={releaseHold}
          onPointerLeave={() => void endHold()}
          onPointerCancel={() => void endHold()}
          onContextMenu={e => e.preventDefault()}
          aria-label={`加入${LIKED_FOLDER_TITLE}`}
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/10 backdrop-blur-md transition-transform active:scale-95 disabled:opacity-40"
          style={{
            boxShadow: isLiked || charge > 0 ? `0 0 ${24 + charge * 40}px -2px #f0607a` : undefined,
            transform: `scale(${1 + charge * 0.25})`,
          }}
        >
          <svg className="pointer-events-none absolute inset-0 -rotate-90" viewBox="0 0 56 56">
            <circle
              cx="28"
              cy="28"
              r={R}
              fill="none"
              stroke="#f0607a"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - charge)}
            />
          </svg>
          {isLiked ? (
            <RiHeart3Fill
              size={26}
              className="text-[#f0607a]"
              style={{ animation: "fm-heart-idle 1.4s ease-in-out infinite" }}
            />
          ) : (
            <RiHeart3Line size={26} className="text-zinc-200" />
          )}
        </button>
        <div className="text-[11px] tracking-widest text-zinc-500">
          {isLiked ? `已在${LIKED_FOLDER_TITLE}` : `点按收藏 · 长按有惊喜`}
        </div>
      </div>
    </div>
  );
};

export default Heartbeat;
