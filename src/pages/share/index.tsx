import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import { Button, Spinner } from "@heroui/react";
import { RiPlayFill } from "@remixicon/react";

import { isValidBvid, parseShareParams } from "@/common/utils/share";
import { formatUrlProtocol } from "@/common/utils/url";
import Image from "@/components/image";
import { getWebInterfaceView, type WebInterfaceViewData } from "@/service/web-interface-view";
import { usePlayList } from "@/store/play-list";

type State =
  | { status: "loading" }
  | { status: "ready"; data: WebInterfaceViewData; cid: string }
  | { status: "error"; message: string };

const CODE_MESSAGES: Record<number, string> = {
  [-400]: "分享链接里的视频号无效，请向分享的人重新要一份",
  [-404]: "这个视频不存在或已被删除，请向分享的人确认链接",
  [-403]: "这个视频需要权限才能访问，无法在这里播放",
  62002: "这个视频已被设为不可见，无法播放",
  62004: "这个视频还在审核中，稍后再试",
  62012: "这个视频仅UP主自己可见，无法播放",
};

const describeFailure = (error: unknown) => {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 412 || status === 429) return "请求过于频繁被 B 站限流，请等一两分钟后再打开链接，不要连续刷新";
  if (status && status >= 500) return "B 站服务暂时不可用，稍后再打开链接试试";
  return "没能连上服务，请检查网络后重新打开链接";
};

const Share = () => {
  const { bvid } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "loading" });
  const autoPlayed = useRef("");

  const start = useCallback((data: WebInterfaceViewData, cid: string) => {
    const page = data.pages?.find(item => String(item.cid) === cid);
    void usePlayList.getState().play({
      type: "mv",
      bvid: data.bvid,
      cid,
      title: data.title,
      cover: formatUrlProtocol(data.pic),
      ownerName: data.owner?.name,
      ownerMid: data.owner?.mid,
      playCount: data.stat?.view,
      duration: page?.duration ?? data.duration,
    });
  }, []);

  useEffect(() => {
    if (!isValidBvid(bvid)) {
      setState({ status: "error", message: "分享链接不完整，请向分享的人重新要一份" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const { cid: wantedCid, pageIndex } = parseShareParams(search);
    getWebInterfaceView({ bvid })
      .then(res => {
        if (cancelled) return;
        if (res?.code !== 0 || !res.data?.pages?.length) {
          setState({
            status: "error",
            message: CODE_MESSAGES[res?.code] ?? `视频暂时无法播放（B 站返回：${res?.message || res?.code}）`,
          });
          return;
        }
        const pages = res.data.pages;
        const page =
          pages.find(item => String(item.cid) === wantedCid) ?? pages.find(item => item.page === pageIndex) ?? pages[0];
        const cid = String(page.cid);
        setState({ status: "ready", data: res.data, cid });
        const key = `${bvid}:${cid}`;
        if (autoPlayed.current !== key) {
          autoPlayed.current = key;
          // 浏览器可能拒绝无手势的自动播放，此时停在已加载状态，由下方按钮完成播放
          start(res.data, cid);
        }
      })
      .catch(error => {
        if (!cancelled) setState({ status: "error", message: describeFailure(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [bvid, search, start]);

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

  const { data, cid } = state;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center space-y-4 px-4 py-10">
      <Image
        src={formatUrlProtocol(data.pic)}
        alt={data.title}
        className="aspect-video w-full max-w-sm rounded-lg object-cover"
      />
      <div className="flex max-w-sm flex-col items-center space-y-1 text-center">
        <span className="text-lg font-medium">{data.title}</span>
        <span className="text-default-500 text-sm">{data.owner?.name}</span>
      </div>
      <Button color="primary" startContent={<RiPlayFill size={18} />} onPress={() => start(data, cid)}>
        播放
      </Button>
    </div>
  );
};

export default Share;
