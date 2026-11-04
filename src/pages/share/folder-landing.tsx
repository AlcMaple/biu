import { useNavigate } from "react-router";

import { Button, Spinner } from "@heroui/react";
import { RiPlayFill } from "@remixicon/react";

import { formatUrlProtocol } from "@/common/utils/url";
import Image from "@/components/image";
import type { PlayItem } from "@/store/play-list";

export type FolderLandingState =
  | { status: "loading" }
  | { status: "ready"; title: string; cover?: string; ownerName?: string; medias: PlayItem[] }
  | { status: "error"; message: string };

export const describeShareFailure = (error: unknown) => {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 412 || status === 429) return "请求过于频繁被限流，请等一两分钟后再打开链接，不要连续刷新";
  if (status && status >= 500) return "服务暂时不可用，稍后再打开链接试试";
  return "没能连上服务，请检查网络后重新打开链接";
};

const FolderLanding = ({ state, onPlay }: { state: FolderLandingState; onPlay: (medias: PlayItem[]) => void }) => {
  const navigate = useNavigate();

  if (state.status === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center space-y-4 px-4 py-20 text-center">
        <span className="text-default-500">{state.message}</span>
        <Button color="primary" onPress={() => navigate("/", { replace: true })}>
          去首页逛逛
        </Button>
      </div>
    );
  }

  const { title, cover, ownerName, medias } = state;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center space-y-4 px-4 py-10">
      {cover && (
        <Image src={formatUrlProtocol(cover)} alt={title} className="aspect-video w-full max-w-sm rounded-lg object-cover" />
      )}
      <div className="flex max-w-sm flex-col items-center space-y-1 text-center">
        <span className="text-lg font-medium">{title}</span>
        <span className="text-default-500 text-sm">
          {ownerName ? `${ownerName} · ` : ""}
          {medias.length} 首
        </span>
      </div>
      <Button color="primary" startContent={<RiPlayFill size={18} />} onPress={() => onPlay(medias)}>
        播放全部
      </Button>
    </div>
  );
};

export default FolderLanding;
