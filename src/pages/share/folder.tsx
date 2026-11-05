import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";

import { getAllFavMedia } from "@/common/utils/fav";
import { isValidFolderId } from "@/common/utils/share";
import { getFavFolderInfo } from "@/service/fav-folder-info";
import { usePlayList, type PlayItem } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";

import FolderLanding, { describeShareFailure, type FolderLandingState } from "./folder-landing";

const CODE_MESSAGES: Record<number, string> = {
  [-400]: "分享链接里的歌单号无效，请向分享的人重新要一份",
  [-403]: "这个歌单是私密的，无法收听。请让分享的人把它设为公开",
  11010: "这个歌单不存在或已被删除，请向分享的人确认链接",
};

const ShareFolder = () => {
  const { id } = useParams();
  const [state, setState] = useState<FolderLandingState>({ status: "loading" });

  const start = useCallback((medias: PlayItem[], index = 0) => {
    // 收听者应当从头听，而不是续上本机之前的进度
    usePlayProgress.getState().setCurrentTime(0);
    void usePlayList.getState().playList(medias, index);
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
        setState({
          status: "ready",
          title: res.data.title,
          cover: res.data.cover,
          ownerName: res.data.upper?.name,
          medias,
        });
      })
      .catch(error => {
        if (!cancelled) setState({ status: "error", message: describeShareFailure(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [id, start]);

  return <FolderLanding state={state} onPlay={start} />;
};

export default ShareFolder;
