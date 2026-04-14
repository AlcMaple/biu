import React, { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import {
  addToast,
  Button,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure,
} from "@heroui/react";
import {
  RiCheckLine,
  RiDeleteBinLine,
  RiEraserLine,
  RiExternalLinkLine,
  RiFileMusicLine,
  RiMoreLine,
  RiPencilLine,
  RiPlayCircleLine,
  RiPlayFill,
  RiPlayListAddLine,
  RiStarLine,
  RiStarOffLine,
} from "@remixicon/react";
import { chunk } from "es-toolkit/array";

import { CollectionType } from "@/common/constants/collection";
import { formatMillisecond } from "@/common/utils/time";
import { openBiliVideoLink } from "@/common/utils/url";
import AsyncButton from "@/components/async-button";
import IconButton from "@/components/icon-button";
import MusicListItem from "@/components/music-list-item";
import MusicListHeader from "@/components/music-list-item/header";
import ScrollContainer, { type ScrollRefObject } from "@/components/scroll-container";
import SearchWithSort from "@/components/search-with-sort";
import { getFavResourceInfos } from "@/service/fav-resource-infos";
import { useFavoritesStore } from "@/store/favorite";
import { type LocalFavItem, useLocalFavItemsStore } from "@/store/local-fav-items";
import { useModalStore } from "@/store/modal";
import { usePlayList } from "@/store/play-list";
import { useTagStore } from "@/store/tags";

import Header from "../header";

const ORDER_OPTIONS = [
  { key: "fav_time", label: "最近收藏" },
  { key: "title", label: "按标题" },
];

const getLocalItemMenus = (isBiliItem: boolean) => [
  { key: "favorite", label: "移动", icon: <RiStarLine size={18} /> },
  { key: "remove", label: "取消收藏", icon: <RiStarOffLine size={18} /> },
  { key: "play-next", label: "下一首播放", icon: <RiPlayCircleLine size={18} /> },
  { key: "add-to-playlist", label: "添加到播放列表", icon: <RiPlayListAddLine size={18} /> },
  { key: "download-audio", label: "下载音频", icon: <RiFileMusicLine size={18} />, hidden: !isBiliItem },
  { key: "rename", label: "重命名", icon: <RiPencilLine size={18} /> },
  { key: "bililink", label: "在 B 站打开", icon: <RiExternalLinkLine size={18} />, hidden: !isBiliItem },
];

const LocalFavorites = () => {
  const { id: folderIdStr } = useParams();
  const folderId = Number(folderIdStr);
  const navigate = useNavigate();

  const scrollRef = useRef<ScrollRefObject>(null);

  const [keyword, setKeyword] = useState("");
  const [order, setOrder] = useState("fav_time");
  const [activeTagIds, setActiveTagIds] = useState<number[]>([]);
  const [renameValue, setRenameValue] = useState("");
  const [renameTarget, setRenameTarget] = useState<LocalFavItem | null>(null);
  const { isOpen: isRenameOpen, onOpen: onRenameOpen, onClose: onRenameClose } = useDisclosure();

  const allTags = useTagStore(s => s.tags);
  const itemTags = useTagStore(s => s.itemTags);

  const folder = useFavoritesStore(s => s.createdFavorites.find(f => f.id === folderId));
  const rawItems = useLocalFavItemsStore(s => s.folderItems[folderId]) ?? [];
  const removeItem = useLocalFavItemsStore(s => s.removeItem);
  const renameItem = useLocalFavItemsStore(s => s.renameItem);
  const clearFolder = useLocalFavItemsStore(s => s.clearFolder);
  const rmCreatedFavorite = useFavoritesStore(s => s.rmCreatedFavorite);

  const onOpenConfirmModal = useModalStore(s => s.onOpenConfirmModal);

  const items = useMemo(() => {
    let result = rawItems;
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      result = result.filter(i => i.title.toLowerCase().includes(kw));
    }
    if (activeTagIds.length > 0) {
      result = result.filter(i => {
        const tags = itemTags[String(i.rid)] ?? [];
        return activeTagIds.some(tid => tags.includes(tid));
      });
    }
    if (order === "title") {
      result = [...result].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    }
    return result;
  }, [rawItems, keyword, order, activeTagIds, itemTags]);

  // 判断是否为本地歌曲（含兼容旧数据：source 字段存入前的本地歌曲）
  const isLocalItem = useCallback(
    (item: LocalFavItem) => item.source === "local" || (item.type === 12 && !item.ownerMid && !item.ownerName),
    [],
  );

  const itemToPlayItem = useCallback((item: LocalFavItem) => {
    if (item.source === "local") {
      return {
        type: "audio" as const,
        source: "local" as const,
        id: String(item.rid),
        title: item.title,
        cover: item.cover,
        audioUrl: item.audioUrl,
      };
    }
    // 兼容旧数据：type=12 且无 ownerMid/ownerName 的项是添加 source 字段前存入的本地歌曲
    if (item.type === 12 && !item.ownerMid && !item.ownerName) {
      return {
        type: "audio" as const,
        source: "local" as const,
        id: String(item.rid),
        title: item.title,
        cover: item.cover,
        audioUrl: item.audioUrl, // 旧数据无 audioUrl，播放时会提示重新收藏
      };
    }
    if (item.type === 2) {
      return {
        type: "mv" as const,
        bvid: item.bvid!,
        title: item.title,
        cover: item.cover,
        ownerMid: item.ownerMid,
        ownerName: item.ownerName,
      };
    }
    return {
      type: "audio" as const,
      sid: Number(item.rid),
      title: item.title,
      cover: item.cover,
      ownerMid: item.ownerMid,
      ownerName: item.ownerName,
    };
  }, []);

  const handleItemPress = useCallback(
    (item: LocalFavItem) => {
      const playItem = itemToPlayItem(item);
      if (playItem.source === "local" && !playItem.audioUrl) {
        addToast({ title: "本地文件路径丢失，请重新收藏该曲目", color: "warning" });
        return;
      }
      usePlayList.getState().play(playItem);
    },
    [itemToPlayItem],
  );

  const handlePlayAll = useCallback(async () => {
    const medias = items.map(itemToPlayItem).filter(m => !(m.source === "local" && !m.audioUrl));
    if (!medias.length) {
      addToast({ title: "暂无可播放内容", color: "warning" });
      return;
    }
    await usePlayList.getState().playList(medias);
  }, [items, itemToPlayItem]);

  const handleAddToPlayList = useCallback(() => {
    const medias = items.map(itemToPlayItem).filter(m => !(m.source === "local" && !m.audioUrl));
    if (!medias.length) {
      addToast({ title: "暂无可播放内容", color: "warning" });
      return;
    }
    usePlayList.getState().addList(medias);
    addToast({ title: `已添加 ${medias.length} 首到播放列表`, color: "success" });
  }, [items, itemToPlayItem]);

  const handleClearInvalid = useCallback(async () => {
    const allItems = useLocalFavItemsStore.getState().folderItems[folderId] ?? [];
    const checkable = allItems.filter(i => i.type === 2 || i.type === 12);
    if (!checkable.length) {
      addToast({ title: "暂无可检测内容", color: "warning" });
      return;
    }

    const chunks = chunk(checkable, 50);
    const invalidRids: (string | number)[] = [];

    for (const chunkItems of chunks) {
      const resources = chunkItems.map(i => `${i.rid}:${i.type}`).join(",");
      const res = await getFavResourceInfos({ resources, platform: "web" });
      if (res.code === 0 && res.data) {
        const validIds = new Set(res.data.filter(i => i.attr === 0).map(i => String(i.id)));
        chunkItems.forEach(item => {
          if (!validIds.has(String(item.rid))) {
            invalidRids.push(item.rid);
          }
        });
      }
    }

    if (!invalidRids.length) {
      addToast({ title: "没有失效内容", color: "success" });
      return;
    }

    invalidRids.forEach(rid => removeItem(folderId, rid));
    addToast({ title: `已清除 ${invalidRids.length} 个失效内容`, color: "success" });
  }, [folderId, removeItem]);

  const handleDeleteFolder = useCallback(() => {
    onOpenConfirmModal({
      title: folder?.title ? `确认删除「${folder.title}」吗？` : "确认删除该收藏夹吗？",
      type: "danger",
      onConfirm: async () => {
        clearFolder(folderId);
        rmCreatedFavorite(folderId);
        navigate("/empty");
        return true;
      },
    });
  }, [clearFolder, folder?.title, folderId, navigate, onOpenConfirmModal, rmCreatedFavorite]);

  const handleMenuAction = useCallback(
    async (key: string, item: LocalFavItem) => {
      const playItem = itemToPlayItem(item);
      const isUnplayableLocal = playItem.source === "local" && !playItem.audioUrl;
      switch (key) {
        case "favorite":
          useModalStore.getState().onOpenFavSelectModal({
            rid: item.rid,
            type: item.type,
            title: `收藏「${item.title}」`,
            itemInfo: {
              title: item.title,
              cover: item.cover,
              bvid: item.bvid,
              ownerName: item.ownerName,
              ownerMid: item.ownerMid,
              duration: item.duration,
              playCount: item.playCount,
            },
          });
          break;
        case "play-next":
          if (isUnplayableLocal) {
            addToast({ title: "本地文件路径丢失，请重新收藏该曲目", color: "warning" });
          } else {
            usePlayList.getState().addToNext(playItem);
          }
          break;
        case "add-to-playlist":
          if (isUnplayableLocal) {
            addToast({ title: "本地文件路径丢失，请重新收藏该曲目", color: "warning" });
          } else {
            usePlayList.getState().addList([playItem]);
            addToast({ title: "已添加到播放列表", color: "success" });
          }
          break;
        case "rename":
          setRenameTarget(item);
          setRenameValue(item.title);
          onRenameOpen();
          break;
        case "download-audio":
          await window.electron.addMediaDownloadTask({
            outputFileType: "audio",
            title: item.title,
            cover: item.cover,
            bvid: item.bvid,
            sid: item.type === 12 ? Number(item.rid) : undefined,
          });
          addToast({ title: "已添加下载任务", color: "success" });
          break;
        case "bililink":
          openBiliVideoLink({
            type: item.type === 2 ? "mv" : "audio",
            bvid: item.bvid,
            sid: item.type === 12 ? Number(item.rid) : undefined,
          });
          break;
        case "remove":
          onOpenConfirmModal({
            title: `确认取消收藏${item.title}？`,
            onConfirm: async () => {
              removeItem(folderId, item.rid);
              addToast({ title: "已取消收藏", color: "success" });
              return true;
            },
          });
          break;
        default:
          break;
      }
    },
    [folderId, itemToPlayItem, onOpenConfirmModal, onRenameOpen, removeItem],
  );

  const dropdownMenuItems = [
    {
      key: "clear-invalid",
      label: "清除失效内容",
      startContent: <RiEraserLine size={18} />,
      className: undefined as string | undefined,
      color: undefined as "danger" | undefined,
      onPress: () => {
        onOpenConfirmModal({
          title: "确认检测并清除失效内容吗？",
          type: "warning",
          onConfirm: async () => {
            await handleClearInvalid();
            return true;
          },
        });
      },
    },
    {
      key: "delete",
      label: "删除收藏夹",
      startContent: <RiDeleteBinLine size={18} />,
      className: "text-danger",
      color: "danger" as const,
      onPress: handleDeleteFolder,
    },
  ];

  return (
    <ScrollContainer enableBackToTop ref={scrollRef} resetOnChange={folderIdStr} className="h-full w-full px-4 pb-6">
      <Header
        type={CollectionType.Favorite}
        cover={folder?.cover}
        title={folder?.title}
        desc={folder?.intro}
        mediaCount={rawItems.length}
      />

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <AsyncButton
            color="primary"
            startContent={<RiPlayFill size={22} />}
            onPress={handlePlayAll}
            className="dark:text-black"
          >
            播放全部
          </AsyncButton>
          <IconButton size="md" variant="flat" tooltip="添加到播放列表" onPress={handleAddToPlayList}>
            <RiPlayListAddLine size={18} />
          </IconButton>
          <Dropdown
            disableAnimation
            placement="bottom-start"
            shouldBlockScroll={false}
            trigger="press"
            classNames={{ content: "min-w-[120px]" }}
          >
            <DropdownTrigger>
              <Button isIconOnly variant="flat" className="hover:text-primary">
                <RiMoreLine />
              </Button>
            </DropdownTrigger>
            <DropdownMenu aria-label="收藏夹操作" items={dropdownMenuItems}>
              {item => (
                <DropdownItem
                  key={item.key}
                  className={item.className}
                  color={item.color}
                  startContent={item.startContent}
                  onPress={item.onPress}
                >
                  {item.label}
                </DropdownItem>
              )}
            </DropdownMenu>
          </Dropdown>
        </div>
        <SearchWithSort
          onKeywordSearch={setKeyword}
          orderOptions={ORDER_OPTIONS}
          order={order}
          onOrderChange={setOrder}
        />
      </div>

      {allTags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {allTags.map(tag => {
            const active = activeTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() =>
                  setActiveTagIds(prev =>
                    prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id],
                  )
                }
                className="flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors"
                style={
                  active
                    ? { backgroundColor: tag.color + "22", color: tag.color, borderColor: tag.color + "88" }
                    : { color: tag.color, borderColor: tag.color + "44" }
                }
              >
                {active && <RiCheckLine size={10} />}
                {tag.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="w-full">
        <MusicListHeader hidePubTime={false} timeTitle="收藏时间" />
        {items.map((item, index) => (
          <MusicListItem
            key={String(item.rid)}
            index={index + 1}
            title={item.title}
            type={item.type === 2 ? "mv" : "audio"}
            bvid={item.type === 2 ? item.bvid : undefined}
            sid={isLocalItem(item) ? undefined : item.type === 12 ? Number(item.rid) : undefined}
            itemId={isLocalItem(item) ? String(item.rid) : undefined}
            source={isLocalItem(item) ? "local" : item.source}
            cover={item.cover}
            upName={isLocalItem(item) ? undefined : item.ownerName}
            upMid={isLocalItem(item) ? undefined : item.ownerMid}
            playCount={item.playCount}
            duration={item.duration}
            pubTime={formatMillisecond(item.fav_time)}
            menus={getLocalItemMenus(!isLocalItem(item))}
            onMenuAction={key => handleMenuAction(key, item)}
            onPress={() => handleItemPress(item)}
          />
        ))}
        {items.length === 0 && rawItems.length === 0 && (
          <div className="py-16 text-center text-sm text-zinc-400">
            暂无内容，可通过音乐收藏按钮将内容添加到此收藏夹
          </div>
        )}
        {items.length === 0 && rawItems.length > 0 && (
          <div className="py-16 text-center text-sm text-zinc-400">没有符合搜索条件的内容</div>
        )}
      </div>
      <Modal isOpen={isRenameOpen} onClose={onRenameClose} size="sm">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <RiPencilLine size={18} />
            重命名
          </ModalHeader>
          <ModalBody>
            <Input
              value={renameValue}
              onValueChange={setRenameValue}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter") {
                  const trimmed = renameValue.trim();
                  if (trimmed && renameTarget) {
                    renameItem(folderId, renameTarget.rid, trimmed);
                    onRenameClose();
                  }
                }
              }}
              placeholder="输入新标题"
              size="sm"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onRenameClose}>
              取消
            </Button>
            <Button
              color="primary"
              isDisabled={!renameValue.trim() || renameValue.trim() === renameTarget?.title}
              onPress={() => {
                const trimmed = renameValue.trim();
                if (trimmed && renameTarget) {
                  renameItem(folderId, renameTarget.rid, trimmed);
                  onRenameClose();
                }
              }}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </ScrollContainer>
  );
};

export default LocalFavorites;
