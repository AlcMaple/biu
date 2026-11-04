import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { Button, Spinner } from "@heroui/react";
import { RiPlayFill } from "@remixicon/react";

import { getAllFavMedia } from "@/common/utils/fav";
import { isValidFolderId } from "@/common/utils/share";
import { formatUrlProtocol } from "@/common/utils/url";
import Image from "@/components/image";
import { getFavFolderInfo, type FavFolderInfoData } from "@/service/fav-folder-info";
import { useModalStore } from "@/store/modal";
import { usePlayList, type PlayItem } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";

type State =
  | { status: "loading" }
  | { status: "ready"; info: FavFolderInfoData; medias: PlayItem[] }
  | { status: "error"; message: string };

const CODE_MESSAGES: Record<number, string> = {
  [-400]: "分享链接里的歌单号无效，请向分享的人重新要一份",
  [-403]: "这个歌单是私密的，无法收听。请让分享的人把它设为公开",
  11010: "这个歌单不存在或已被删除，请向分享的人确认链接",
};

const describeFailure = (error: unknown) => {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 412 || status === 429) return "请求过于频繁被 B 站限流，请等一两分钟后再打开链接，不要连续刷新";
  if (status && status >= 500) return "B 站服务暂时不可用，稍后再打开链接试试";
  return "没能连上服务，请检查网络后重新打开链接";
};

const ShareFolder = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "loading" });
  const autoPlayed = useRef("");

  const start = useCallback((medias: PlayItem[]) => {
    // 收听者应当从头听，而不是续上本机之前的进度
    usePlayProgress.getState().setCurrentTime(0);
    void usePlayList.getState().playList(medias);
  }, []);

  useEffect(() => {
    if (!isValidFolderId(id)) {
      setState({ status: "error", message: "分享链接不完整，请向分享的人重新要一份" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    getFavFolderInfo({ media_id: id })
      .then(async res => {
        if (cancelled) return;
        if (res?.code !== 0 || !res.data) {
          setState({
            status: "error",
            message: CODE_MESSAGES[res?.code] ?? `歌单暂时无法打开（B 站返回：${res?.message || res?.code}）`,
          });
          return;
        }
        const medias = await getAllFavMedia({ id });
        if (cancelled) return;
        if (!medias.length) {
          setState({ status: "error", message: "这个歌单里没有可播放的内容" });
          return;
        }
        setState({ status: "ready", info: res.data, medias });
        if (autoPlayed.current !== id) {
          autoPlayed.current = id;
          // 浏览器可能拒绝无手势的自动播放，此时由全屏播放器里的播放键或下方按钮完成
          start(medias);
          useModalStore.getState().openFullScreenPlayer();
        }
      })
      .catch(error => {
        if (!cancelled) setState({ status: "error", message: describeFailure(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [id, start]);

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

  const { info, medias } = state;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center space-y-4 px-4 py-10">
      <Image
        src={formatUrlProtocol(info.cover)}
        alt={info.title}
        className="aspect-video w-full max-w-sm rounded-lg object-cover"
      />
      <div className="flex max-w-sm flex-col items-center space-y-1 text-center">
        <span className="text-lg font-medium">{info.title}</span>
        <span className="text-default-500 text-sm">
          {info.upper?.name} · {medias.length} 首
        </span>
      </div>
      <Button color="primary" startContent={<RiPlayFill size={18} />} onPress={() => start(medias)}>
        播放全部
      </Button>
    </div>
  );
};

export default ShareFolder;
