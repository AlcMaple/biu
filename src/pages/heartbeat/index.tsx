import { useEffect } from "react";

import { addToast } from "@heroui/react";
import { RiHeart3Fill, RiHeart3Line, RiHeartPulseFill, RiSkipForwardFill } from "@remixicon/react";
import { AnimatePresence, motion } from "framer-motion";

import { LIKED_FOLDER_ID, LIKED_FOLDER_TITLE } from "@/common/constants/heartbeat";
import Image from "@/components/image";
import { restoreSession, useHeartbeat } from "@/store/heartbeat";
import { type LocalFavItem, useLocalFavItemsStore } from "@/store/local-fav-items";
import { usePlayList } from "@/store/play-list";

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

  const title = current ? current.pageTitle || current.title : "相似推荐";
  const cover = current ? current.pageCover || current.cover : "";
  const owner = current?.customArtist || current?.ownerName || "";
  const next = usePlayList(s => s.next);

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden p-6 select-none md:gap-8 md:p-8">
      <AnimatePresence>
        {cover && (
          <motion.img
            key={cover}
            src={cover}
            alt=""
            aria-hidden
            referrerPolicy="no-referrer"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40 blur-3xl saturate-150"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          />
        )}
      </AnimatePresence>
      <div className="from-background/30 via-background/60 to-background pointer-events-none absolute inset-0 bg-gradient-to-b" />

      <div className="text-primary relative flex items-center gap-1.5 text-xs tracking-widest">
        <RiHeartPulseFill size={14} />
        相似推荐
      </div>

      <motion.div
        key={cover}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative aspect-square w-[min(72vw,20rem)] md:w-72 lg:w-80"
      >
        <motion.div
          animate={{ scale: isPlaying ? 1 : 0.94 }}
          transition={{ duration: 0.3 }}
          className="bg-content2 h-full w-full overflow-hidden rounded-2xl shadow-[0_20px_60px_-10px_rgba(0,0,0,0.7)]"
        >
          {cover ? (
            <Image
              removeWrapper
              radius="none"
              src={cover}
              alt={title}
              params="672w_378h_1c.avif"
              classNames={{ img: "h-full w-full object-cover" }}
            />
          ) : (
            <div className="text-primary flex h-full w-full items-center justify-center">
              <RiHeartPulseFill size={40} />
            </div>
          )}
        </motion.div>
      </motion.div>

      <motion.div
        key={title}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative flex max-w-2xl flex-col items-center gap-2 text-center"
      >
        <div className="line-clamp-2 text-xl leading-tight font-bold text-balance md:text-2xl">{title}</div>
        <div className="text-sm text-zinc-400">{owner}</div>
      </motion.div>

      <div className="relative flex items-center gap-6">
        <button
          type="button"
          disabled={!current || loading}
          onClick={handleLike}
          aria-label={isLiked ? `移出${LIKED_FOLDER_TITLE}` : `加入${LIKED_FOLDER_TITLE}`}
          aria-pressed={isLiked}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 backdrop-blur-md transition-transform active:scale-95 disabled:opacity-40"
        >
          {isLiked ? (
            <RiHeart3Fill size={26} className="text-[#f0607a]" />
          ) : (
            <RiHeart3Line size={26} className="text-zinc-200" />
          )}
        </button>
        <button
          type="button"
          disabled={!current || loading}
          onClick={() => void next()}
          aria-label="下一首"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 backdrop-blur-md transition-transform active:scale-95 disabled:opacity-40"
        >
          <RiSkipForwardFill size={24} className="text-zinc-200" />
        </button>
      </div>
    </div>
  );
};

export default Heartbeat;
