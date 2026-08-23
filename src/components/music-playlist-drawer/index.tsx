import React, { useCallback, useMemo, useRef } from "react";

import { addToast, Drawer, DrawerBody, DrawerContent, DrawerHeader, Switch } from "@heroui/react";
import { RiDeleteBinLine, RiFocus3Line } from "@remixicon/react";
import { uniqBy } from "es-toolkit/array";

import { PlayMode } from "@/common/constants/audio";
import { useIsMobileLayout } from "@/common/hooks/use-responsive";
import { getPlayListDisplayKey, isSamePlayListDisplayItem } from "@/common/utils/playlist-display";
import { openBiliVideoLink } from "@/common/utils/url";
import { type ScrollRefObject } from "@/components/scroll-container";
import { VirtualList } from "@/components/virtual-list";
import platform from "@/platform";
import { useModalStore } from "@/store/modal";
import { usePlayList, type PlayData } from "@/store/play-list";
import { useUser } from "@/store/user";

import Empty from "../empty";
import IconButton from "../icon-button";
import ListItem from "./list-item";

const RowHeight = 64;

const PlayListDrawer = () => {
  const scrollRef = useRef<ScrollRefObject | null>(null);
  const isOpen = useModalStore(s => s.isPlayListDrawerOpen);
  const setOpen = useModalStore(s => s.setPlayListDrawerOpen);
  const list = usePlayList(s => s.list);
  const playId = usePlayList(s => s.playId);
  const playMode = usePlayList(s => s.playMode);
  const clear = usePlayList(s => s.clear);
  const shouldKeepPagesOrderInRandomPlayMode = usePlayList(s => s.shouldKeepPagesOrderInRandomPlayMode);
  const setShouldKeepPagesOrderInRandomPlayMode = usePlayList(s => s.setShouldKeepPagesOrderInRandomPlayMode);
  const user = useUser(s => s.user);
  const playListItem = usePlayList(state => state.playListItem);
  const isMobileLayout = useIsMobileLayout();

  const playItem = useMemo(() => list.find(item => item.id === playId), [list, playId]);
  const pureList = useMemo(() => {
    return uniqBy(list, getPlayListDisplayKey);
  }, [list]);

  const handleAction = useCallback(async (key: string, item: PlayData) => {
    switch (key) {
      case "favorite":
        useModalStore.getState().onOpenFavSelectModal({
          rid: item.type === "mv" ? (item.aid ?? item.bvid ?? item.id) : (item.sid ?? item.id),
          type: item.type === "mv" ? 2 : 12,
          title: item.title,
          itemInfo: {
            title: item.title,
            cover: item.cover,
            bvid: item.bvid,
            ownerName: item.ownerName,
            ownerMid: item.ownerMid,
            duration: item.duration,
          },
        });
        break;
      case "download-audio":
        await platform.addMediaDownloadTask({
          outputFileType: "audio",
          title: item.title,
          cover: item.cover,
          bvid: item.bvid,
          sid: item.type === "audio" ? item.id : undefined,
        });
        addToast({
          title: "已添加下载任务",
          color: "success",
        });
        break;
      case "download-video":
        await platform.addMediaDownloadTask({
          outputFileType: "video",
          title: item.title,
          cover: item.cover,
          bvid: item.bvid,
        });
        addToast({
          title: "已添加下载任务",
          color: "success",
        });
        break;
      case "bililink":
        openBiliVideoLink(item);
        break;
      case "del":
        usePlayList.getState().del(item.id);
        break;
      default:
        break;
    }
  }, []);

  const scrollToPlayItem = useCallback(() => {
    if (!playItem) {
      addToast({ title: "当前没有正在播放的歌曲", color: "warning" });
      return;
    }

    const targetIndex = pureList.findIndex(item => isSamePlayListDisplayItem(playItem, item));
    if (targetIndex < 0) {
      addToast({ title: "未在列表中找到当前播放的歌曲", color: "warning" });
      return;
    }

    const viewport = scrollRef.current?.osInstance()?.elements().viewport as HTMLElement | null;
    if (!viewport) {
      return;
    }

    const targetTop = targetIndex * RowHeight;
    const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const nextTop = Math.min(targetTop, maxTop);

    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ top: nextTop, behavior: "smooth" });
    } else {
      viewport.scrollTop = nextTop;
    }
  }, [playItem, pureList]);

  return (
    <Drawer
      radius="md"
      shadow="md"
      backdrop={isMobileLayout ? "opaque" : "transparent"}
      size={isMobileLayout ? "xs" : "sm"}
      hideCloseButton
      disableAnimation
      isOpen={isOpen}
      onOpenChange={setOpen}
      classNames={{
        backdrop: "z-200 window-no-drag",
        wrapper: "z-200 window-no-drag",
        base: isMobileLayout
          ? "data-[placement=right]:mr-[env(safe-area-inset-right)] data-[placement=right]:mb-[calc(88px+env(safe-area-inset-bottom))] w-4/5 max-w-[360px]"
          : "data-[placement=right]:mb-22",
      }}
    >
      <DrawerContent>
        <DrawerHeader className="border-divider/40 flex flex-row items-center justify-between space-x-2 border-b px-4 py-3">
          <h3>
            播放列表<span className="text-default-500 text-sm">({pureList?.length || 0})</span>
          </h3>
          <div className="flex items-center">
            {Boolean(pureList?.length) && (
              <>
                <IconButton tooltip="定位当前播放" onPress={scrollToPlayItem}>
                  <RiFocus3Line size={16} />
                </IconButton>
                <IconButton tooltip="清空播放列表" onPress={clear} className="hover:text-danger">
                  <RiDeleteBinLine size={16} />
                </IconButton>
              </>
            )}
          </div>
        </DrawerHeader>
        {playMode === PlayMode.Random && (
          <div className="border-divider/40 flex items-center justify-between gap-4 border-b px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm">保持分集顺序</p>
              <p className="text-default-500 text-xs">随机播放多分集视频时，优先连续播放下一集</p>
            </div>
            <Switch
              aria-label="保持分集顺序"
              className="flex-none"
              disableAnimation
              isSelected={shouldKeepPagesOrderInRandomPlayMode}
              onValueChange={setShouldKeepPagesOrderInRandomPlayMode}
              size="sm"
            />
          </div>
        )}
        {list.length ? (
          <DrawerBody className="overflow-hidden px-0">
            <VirtualList
              className="h-full w-full px-2"
              scrollRef={scrollRef}
              data={pureList}
              itemHeight={RowHeight}
              renderItem={item => (
                <ListItem
                  data={item}
                  isLogin={Boolean(user?.isLogin)}
                  isPlaying={isSamePlayListDisplayItem(playItem, item)}
                  onClose={() => setOpen(false)}
                  onPress={() => playListItem(item.id)}
                  onAction={key => handleAction(key, item)}
                />
              )}
            />
          </DrawerBody>
        ) : (
          <Empty />
        )}
      </DrawerContent>
    </Drawer>
  );
};

export default PlayListDrawer;
