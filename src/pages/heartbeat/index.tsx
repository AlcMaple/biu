import { useEffect } from "react";

import { addToast, Button } from "@heroui/react";
import { RiHeartPulseFill, RiHeart3Line } from "@remixicon/react";

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

      <div className="flex max-w-2xl flex-col items-center gap-1 text-center">
        <div className="line-clamp-2 text-lg font-semibold text-balance">{title}</div>
        <div className="text-sm text-zinc-500">{owner}</div>
      </div>

      {/* 播放控制交给底部播放栏，这里只保留 FM 的核心动作：把在听的歌收进「我喜欢的音乐」。
          幽灵文字按钮，文本恒定；收藏与否只体现在文字微亮 + 心形着色，保持克制不抢镜。 */}
      <Button
        variant="light"
        radius="full"
        size="lg"
        disableRipple
        isLoading={loading}
        isDisabled={!current}
        onPress={handleLike}
        startContent={!loading && <RiHeart3Line size={20} className={isLiked ? "text-[#f0607a]" : ""} />}
        className={`px-4 font-medium data-[hover=true]:bg-transparent data-[pressed=true]:bg-transparent ${
          isLiked ? "text-zinc-300" : "text-zinc-400"
        }`}
      >
        加入{LIKED_FOLDER_TITLE}
      </Button>

      <div className="max-w-2xl text-center text-xs text-balance text-zinc-400">
        私人FM · 根据「{LIKED_FOLDER_TITLE}」为你不断推荐相似单曲，边听边用 ❤️ 收藏你喜欢的
      </div>
    </div>
  );
};

export default Heartbeat;
