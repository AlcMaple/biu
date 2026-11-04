import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";

import { isValidShareCode } from "@/common/utils/share";
import { parseDuration } from "@/common/utils/time";
import { getSharedFolder, type SharedFolderItem } from "@/service/shared-folder";
import { useModalStore } from "@/store/modal";
import { usePlayList, type PlayItem } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";

import FolderLanding, { describeShareFailure, type FolderLandingState } from "./folder-landing";

const toPlayItem = (item: SharedFolderItem): PlayItem => {
  const common = {
    title: item.title,
    cover: item.cover,
    ownerMid: item.ownerMid,
    ownerName: item.ownerName,
    playCount: item.playCount,
    duration: parseDuration(item.duration),
  };
  if (item.type === 2) return { ...common, type: "mv", bvid: item.bvid!, cid: item.cid };
  return { ...common, type: "audio", sid: Number(item.rid) };
};

const ShareLocal = () => {
  const { code } = useParams();
  const [state, setState] = useState<FolderLandingState>({ status: "loading" });
  const autoPlayed = useRef("");

  const start = useCallback((medias: PlayItem[]) => {
    usePlayProgress.getState().setCurrentTime(0);
    void usePlayList.getState().playList(medias);
  }, []);

  useEffect(() => {
    if (!isValidShareCode(code)) {
      setState({ status: "error", message: "分享链接不完整，请向分享的人重新要一份" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    getSharedFolder(code)
      .then(data => {
        if (cancelled) return;
        const medias = data.items.map(toPlayItem);
        if (!medias.length) {
          setState({ status: "error", message: "这个歌单里没有可播放的内容" });
          return;
        }
        setState({ status: "ready", title: data.title, cover: data.cover, ownerName: data.ownerName, medias });
        if (autoPlayed.current !== code) {
          autoPlayed.current = code;
          start(medias);
          useModalStore.getState().openFullScreenPlayer();
        }
      })
      .catch(error => {
        if (cancelled) return;
        const status = (error as { response?: { status?: number } })?.response?.status;
        setState({
          status: "error",
          message: status === 404 ? "这个分享不存在或已失效，请向分享的人确认链接" : describeShareFailure(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [code, start]);

  return <FolderLanding state={state} onPlay={start} />;
};

export default ShareLocal;
