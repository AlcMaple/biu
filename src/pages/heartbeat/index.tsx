import { addToast, Button } from "@heroui/react";
import { RiHeartPulseFill, RiPlayFill } from "@remixicon/react";

import { LIKED_FOLDER_ID, LIKED_FOLDER_TITLE } from "@/common/constants/heartbeat";
import { useHeartbeat } from "@/store/heartbeat";
import { useLocalFavItemsStore } from "@/store/local-fav-items";

const Heartbeat = () => {
  const loading = useHeartbeat(s => s.loading);
  const active = useHeartbeat(s => s.active);
  const start = useHeartbeat(s => s.start);
  const likedCount = useLocalFavItemsStore(s => (s.folderItems[LIKED_FOLDER_ID] ?? []).filter(i => !i.invalid).length);

  const handleStart = async () => {
    const res = await start();
    if (res === "empty") {
      addToast({ title: `先往「${LIKED_FOLDER_TITLE}」加几首歌`, color: "warning" });
    } else if (res === "likes-only") {
      addToast({ title: "相似候选太少，先随机播放你喜欢的", color: "warning" });
    } else if (res === "error") {
      addToast({ title: "启动失败，请稍后重试", color: "danger" });
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="text-primary">
          <RiHeartPulseFill size={64} />
        </div>
        <h1 className="text-2xl font-semibold">私人FM</h1>
        <p className="max-w-md text-sm text-zinc-500">
          根据「{LIKED_FOLDER_TITLE}」为你不断推荐相似单曲，并时不时插播你喜欢的歌。
        </p>
        <p className="text-xs text-zinc-400">当前红心歌曲：{likedCount} 首</p>
      </div>

      <Button
        color="primary"
        size="lg"
        radius="full"
        isLoading={loading}
        startContent={loading ? undefined : <RiPlayFill size={22} />}
        onPress={handleStart}
      >
        {active ? "换一批开始" : "开始私人FM"}
      </Button>
    </div>
  );
};

export default Heartbeat;
