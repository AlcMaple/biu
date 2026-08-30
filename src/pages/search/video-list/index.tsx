import React, { useCallback, useEffect, useState } from "react";

import { addToast, Button, Spinner } from "@heroui/react";

import { stripHtml } from "@/common/utils/str";
import { parseDuration } from "@/common/utils/time";
import { formatUrlProtocol } from "@/common/utils/url";
import Empty from "@/components/empty";
import platform, { log } from "@/platform";
import { getWebInterfaceWbiSearchType, type SearchVideoItem } from "@/service/web-interface-search-type";
import { useModalStore } from "@/store/modal";
import { usePlayList } from "@/store/play-list";
import { useSettings } from "@/store/settings";

import GridList from "./grid-list";
import List from "./list";
import SearchHeader, { type SortOrder } from "./search-header";

export type SearchVideoProps = {
  keyword: string;
  getScrollElement: () => HTMLElement | null;
};

export default function SearchVideo({ keyword, getScrollElement }: SearchVideoProps) {
  const displayMode = useSettings(state => state.displayMode);

  const [musicOnly, setMusicOnly] = useState(true);
  const [order, setOrder] = useState<SortOrder>("totalrank");
  const [list, setList] = useState<SearchVideoItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoading, setInitialLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialError, setInitialError] = useState(false);

  const fetchPage = useCallback(
    async (pn: number) => {
      const res = await getWebInterfaceWbiSearchType<SearchVideoItem>({
        search_type: "video",
        keyword,
        page: pn,
        page_size: 24,
        order,
        ...(musicOnly && { tids: 3 }), // B 站音乐分区的 tid 固定为 3。
      });

      // BFF 会透传 B 站的业务错误并保持 HTTP 200；只看 HTTP 状态会把 -400/-412
      // 当成「正常空列表」，用户看到的就是暂无内容而不是可重试的失败态。
      if (res?.code !== 0 || !res?.data || !Array.isArray(res.data.result)) {
        const error = new Error("Bilibili search request failed");
        Object.assign(error, { biliCode: res?.code, biliMessage: res?.message });
        throw error;
      }

      const items = res?.data?.result ?? [];
      const total = res?.data?.numResults ?? 0;
      return { items, total };
    },
    [keyword, musicOnly, order],
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    try {
      setLoadingMore(true);
      const nextPage = page + 1;
      const { items, total } = await fetchPage(nextPage);
      setList(prev => {
        const newList = [...prev, ...items];
        setHasMore(newList.length < total);
        return newList;
      });
      setPage(nextPage);
    } catch (error) {
      const details = error && typeof error === "object" ? (error as Record<string, unknown>) : undefined;
      log.warn("[search] 视频列表加载更多失败", {
        biliCode: details?.biliCode,
        httpStatus: (details?.response as { status?: number } | undefined)?.status,
        errorCode: details?.code,
      });
      addToast({ title: "加载更多失败", color: "danger" });
    } finally {
      setLoadingMore(false);
    }
  }, [page, loadingMore, hasMore, fetchPage]);

  const retryInitial = useCallback(async () => {
    if (!keyword) return;
    setInitialLoading(true);
    setInitialError(false);
    setList([]);
    setPage(1);
    setHasMore(true);
    try {
      const { items, total } = await fetchPage(1);
      setList(items);
      setHasMore(items.length < total);
    } catch (error) {
      const details = error && typeof error === "object" ? (error as Record<string, unknown>) : undefined;
      log.warn("[search] 视频列表初次加载失败", {
        biliCode: details?.biliCode,
        httpStatus: (details?.response as { status?: number } | undefined)?.status,
        errorCode: details?.code,
      });
      setInitialError(true);
      addToast({ title: "加载失败", description: "搜索请求失败，请检查网络后重试", color: "danger" });
    } finally {
      setInitialLoading(false);
    }
  }, [fetchPage, keyword]);

  useEffect(() => {
    void retryInitial();
  }, [retryInitial]);

  const handlePlayAll = useCallback(async () => {
    const items = list.map(item => ({
      type: "mv" as const,
      bvid: item.bvid,
      title: stripHtml(item.title),
      cover: formatUrlProtocol(item.pic),
      ownerName: item.author,
      ownerMid: item.mid,
      playCount: item.play,
      duration: parseDuration(item.duration),
    }));

    usePlayList.getState().addList(items);
    addToast({ title: `已添加 ${items.length} 首到播放列表`, color: "success" });
  }, [list]);

  const handleMenuAction = useCallback(async (key: string, item: SearchVideoItem) => {
    const musicItem = {
      type: "mv" as const,
      bvid: item.bvid,
      title: stripHtml(item.title),
      cover: formatUrlProtocol(item.pic),
      ownerName: item.author,
      ownerMid: item.mid,
      playCount: item.play,
      duration: parseDuration(item.duration),
    };

    switch (key) {
      case "play-next":
        usePlayList.getState().addToNext(musicItem);
        addToast({ title: "已添加到下一首播放", color: "success" });
        break;
      case "add-to-playlist":
        usePlayList.getState().addList([musicItem]);
        addToast({ title: "已添加到播放列表", color: "success" });
        break;
      case "favorite":
        useModalStore.getState().onOpenFavSelectModal({
          rid: item.aid,
          type: 2,
          title: (
            <div>
              收藏
              <span dangerouslySetInnerHTML={{ __html: item.title }} />
            </div>
          ),
          itemInfo: {
            title: stripHtml(item.title),
            cover: formatUrlProtocol(item.pic),
            bvid: item.bvid,
            ownerName: item.author,
            ownerMid: item.mid,
            duration: item.duration,
            playCount: item.play,
          },
        });
        break;
      case "download-audio":
        await platform.addMediaDownloadTask({
          outputFileType: "audio",
          title: stripHtml(item.title),
          cover: formatUrlProtocol(item.pic),
          bvid: item.bvid,
        });
        addToast({
          title: "已添加下载任务",
          color: "success",
        });
        break;
      case "download-video":
        await platform.addMediaDownloadTask({
          outputFileType: "video",
          title: stripHtml(item.title),
          cover: formatUrlProtocol(item.pic),
          bvid: item.bvid,
        });
        addToast({
          title: "已添加下载任务",
          color: "success",
        });
        break;
      case "bililink":
        platform.openExternal(`https://www.bilibili.com/video/${item.bvid}`);
        break;
      default:
        break;
    }
  }, []);

  return (
    <>
      <SearchHeader
        order={order}
        onOrderChange={setOrder}
        musicOnly={musicOnly}
        onMusicOnlyChange={setMusicOnly}
        onPlayAll={handlePlayAll}
        playAllDisabled={initialLoading || list.length === 0}
      />
      {initialLoading && (
        <div className="flex min-h-[280px] items-center justify-center">
          <Spinner label="加载中" />
        </div>
      )}
      {!initialLoading && initialError && (
        <div role="alert" className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-center">
          <p className="text-default-500">搜索加载失败，请检查网络后重试</p>
          <Button size="sm" color="primary" onPress={() => void retryInitial()}>
            重新加载
          </Button>
        </div>
      )}
      {!initialLoading && !initialError && !list?.length && <Empty className="min-h-[280px]" />}
      {!initialLoading && !initialError && list?.length > 0 && (
        <>
          {displayMode === "card" ? (
            <GridList
              items={list}
              getScrollElement={getScrollElement}
              onMenuAction={handleMenuAction}
              loading={loadingMore}
              hasMore={hasMore}
              onLoadMore={loadMore}
            />
          ) : (
            <List
              items={list}
              getScrollElement={getScrollElement}
              onMenuAction={handleMenuAction}
              loading={loadingMore}
              hasMore={hasMore}
              onLoadMore={loadMore}
            />
          )}
        </>
      )}
    </>
  );
}
