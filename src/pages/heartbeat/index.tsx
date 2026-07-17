import { useEffect } from "react";

import { addToast, Button, Tooltip } from "@heroui/react";
import {
  RiHeartPulseFill,
  RiHeart3Fill,
  RiHeart3Line,
  RiPauseFill,
  RiPlayFill,
  RiSkipBackFill,
  RiSkipForwardFill,
} from "@remixicon/react";

import { LIKED_FOLDER_ID, LIKED_FOLDER_TITLE } from "@/common/constants/heartbeat";
import { restoreSession, useHeartbeat } from "@/store/heartbeat";
import { useLocalFavItemsStore } from "@/store/local-fav-items";
import { usePlayList } from "@/store/play-list";

const Heartbeat = () => {
  const loading = useHeartbeat(s => s.loading);
  const start = useHeartbeat(s => s.start);
  const toggleLikeCurrent = useHeartbeat(s => s.toggleLikeCurrent);

  const playId = usePlayList(s => s.playId);
  const list = usePlayList(s => s.list);
  const isPlaying = usePlayList(s => s.isPlaying);
  const togglePlay = usePlayList(s => s.togglePlay);
  const prev = usePlayList(s => s.prev);
  const next = usePlayList(s => s.next);

  const current = list.find(i => i.id === playId);
  const likedItems = useLocalFavItemsStore(s => s.folderItems[LIKED_FOLDER_ID] ?? []);
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

  const title = current ? current.pageTitle || current.title : "私人FM";
  const cover = current ? current.pageCover || current.cover : "";
  const owner = current?.customArtist || current?.ownerName || "";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="bg-content2 relative aspect-square w-64 max-w-[70vw] overflow-hidden rounded-2xl shadow-lg">
        {cover ? (
          <img src={cover} alt={title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="text-primary flex h-full w-full items-center justify-center">
            <RiHeartPulseFill size={72} />
          </div>
        )}
      </div>

      <div className="flex max-w-md flex-col items-center gap-1 text-center">
        <div className="line-clamp-2 text-lg font-semibold">{title}</div>
        <div className="text-sm text-zinc-500">{owner}</div>
      </div>

      <div className="flex items-center gap-4">
        <Tooltip closeDelay={0} content="上一首">
          <Button isIconOnly variant="light" radius="full" size="lg" onPress={prev} isDisabled={!current}>
            <RiSkipBackFill size={24} />
          </Button>
        </Tooltip>

        <Button
          isIconOnly
          color="primary"
          radius="full"
          size="lg"
          className="h-16 w-16"
          isLoading={loading}
          onPress={togglePlay}
          isDisabled={!current}
        >
          {isPlaying ? <RiPauseFill size={30} /> : <RiPlayFill size={30} />}
        </Button>

        <Tooltip closeDelay={0} content="下一首">
          <Button isIconOnly variant="light" radius="full" size="lg" onPress={next} isDisabled={!current}>
            <RiSkipForwardFill size={24} />
          </Button>
        </Tooltip>

        <Tooltip closeDelay={0} content={isLiked ? `移出「${LIKED_FOLDER_TITLE}」` : `加入「${LIKED_FOLDER_TITLE}」`}>
          <Button
            isIconOnly
            variant="light"
            radius="full"
            size="lg"
            color={isLiked ? "danger" : "default"}
            onPress={handleLike}
            isDisabled={!current}
          >
            {isLiked ? <RiHeart3Fill size={24} /> : <RiHeart3Line size={24} />}
          </Button>
        </Tooltip>
      </div>

      <div className="max-w-md text-center text-xs text-zinc-400">
        私人FM · 根据「{LIKED_FOLDER_TITLE}」为你不断推荐相似单曲，边听边用 ❤️ 收藏你喜欢的
      </div>
    </div>
  );
};

export default Heartbeat;
