import { useNavigate } from "react-router";

import { Button, Spinner } from "@heroui/react";
import { RiPlayFill } from "@remixicon/react";

import { formatDuration } from "@/common/utils/time";
import { formatUrlProtocol } from "@/common/utils/url";
import Image from "@/components/image";
import ScrollContainer from "@/components/scroll-container";
import { usePlayList, type PlayItem } from "@/store/play-list";

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

interface Props {
  state: FolderLandingState;
  // index 缺省时从头播放整个歌单；给了就从这一首开始
  onPlay: (medias: PlayItem[], index?: number) => void;
}

const FolderLanding = ({ state, onPlay }: Props) => {
  const navigate = useNavigate();
  const playingKey = usePlayList(s => {
    const item = s.list.find(i => i.id === s.playId);
    return item ? (item.bvid ?? String(item.sid)) : undefined;
  });

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
    <ScrollContainer pageScroll className="h-full w-full px-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-10">
        <div className="flex flex-col items-center gap-4 pt-6 sm:flex-row sm:items-end">
          {cover && (
            <Image
              src={formatUrlProtocol(cover)}
              alt={title}
              className="aspect-video w-full max-w-xs flex-none rounded-lg object-cover sm:w-56"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center sm:items-start sm:text-left">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="line-clamp-2 text-2xl font-semibold break-words">{title}</h1>
              <span className="text-default-500 text-sm">
                {ownerName ? `${ownerName} · ` : ""}
                {medias.length} 首
              </span>
            </div>
            <Button color="primary" startContent={<RiPlayFill size={18} />} onPress={() => onPlay(medias)}>
              播放全部
            </Button>
          </div>
        </div>
        <ul>
          {medias.map((media, index) => {
            const active = playingKey === (media.bvid ?? String(media.sid));
            return (
              <li key={`${media.bvid ?? media.sid}-${index}`} className="[content-visibility:auto]">
                <button
                  type="button"
                  onClick={() => onPlay(medias, index)}
                  className={`hover:bg-default-100 flex w-full items-center gap-3 rounded-md p-2 text-left ${active ? "bg-primary/10 text-primary" : ""}`}
                >
                  <span className="text-default-400 w-8 flex-none text-center text-sm">{index + 1}</span>
                  <Image
                    removeWrapper
                    radius="md"
                    src={formatUrlProtocol(media.cover ?? "")}
                    alt={media.title}
                    className="h-10 w-10 flex-none object-cover"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{media.title}</span>
                    <span className="text-default-500 truncate text-xs">{media.ownerName}</span>
                  </div>
                  {media.duration ? (
                    <span className="text-default-400 flex-none text-xs">{formatDuration(media.duration)}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </ScrollContainer>
  );
};

export default FolderLanding;
