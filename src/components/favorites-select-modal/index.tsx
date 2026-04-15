import React, { useEffect, useRef, useState } from "react";

import {
  addToast,
  Button,
  Checkbox,
  Chip,
  Divider,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
} from "@heroui/react";
import { RiCheckLine, RiTimeLine } from "@remixicon/react";
import { useRequest } from "ahooks";

import type { Page } from "@/service/web-interface-view";

import { formatDuration } from "@/common/utils/time";
import { getFavFolderCreatedListAll } from "@/service/fav-folder-created-list-all";
import { postFavFolderDeal } from "@/service/fav-folder-deal";
import { getAudioCreatedFavList } from "@/service/medialist-gateway-base-created";
import { postCollResourceDeal } from "@/service/medialist-gateway-coll-resource-deal";
import { getWebInterfaceView } from "@/service/web-interface-view";
import { useFavoritesStore } from "@/store/favorite";
import { useLocalFavItemsStore } from "@/store/local-fav-items";
import { useModalStore } from "@/store/modal";
import { useMusicFavStore } from "@/store/music-fav";
import { usePlayList } from "@/store/play-list";
import { useSettings } from "@/store/settings";
import { useTagStore } from "@/store/tags";
import { useUser } from "@/store/user";

import AsyncButton from "../async-button";
import ScrollContainer from "../scroll-container";

const hasSameIds = (arr1: number[], arr2: number[]) => {
  if (arr1.length !== arr2.length) {
    return false;
  }
  const set2 = new Set(arr2);
  return arr1.every(item => set2.has(item));
};

/** 将视频添加到收藏夹或从收藏夹中移除 */
const FavoritesSelectModal = () => {
  const user = useUser(s => s.user);
  const isFavSelectModalOpen = useModalStore(s => s.isFavSelectModalOpen);
  const onFavSelectModalOpenChange = useModalStore(s => s.onFavSelectModalOpenChange);
  const favSelectModalData = useModalStore(s => s.favSelectModalData);
  const { rid, type = 2, title, itemInfo, isLocal, onSuccess } = favSelectModalData || {};

  // 用 createdFavorites（引用稳定）再在 render 里 filter，避免 selector 每次返回新数组引用导致无限渲染
  const createdFavorites = useFavoritesStore(s => s.createdFavorites);
  const hiddenMenuKeys = useSettings(s => s.hiddenMenuKeys);
  const localFolders = createdFavorites.filter(f => f.isLocal && !hiddenMenuKeys.includes(String(f.id)));

  // 用具体 selector 避免订阅整个 store 导致不必要的重渲染
  const folderItems = useLocalFavItemsStore(s => s.folderItems);
  const addLocalItem = useLocalFavItemsStore(s => s.addItem);
  const removeLocalItem = useLocalFavItemsStore(s => s.removeItem);

  const allTags = useTagStore(s => s.tags);
  const getItemTagIds = useTagStore(s => s.getItemTagIds);
  const setItemTagsInStore = useTagStore(s => s.setItemTags);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const prevSelectedRef = useRef<number[]>([]);

  // 分集选择状态（仅 type=2 多P视频时有效）
  // "whole" = 收藏整个视频，数字字符串 = 收藏指定分集的 cid
  const [videoPages, setVideoPages] = useState<Page[]>([]);
  const [pickedCid, setPickedCid] = useState<string>("whole");
  // step 0: 选集 step 1: 选收藏夹
  const [step, setStep] = useState<0 | 1>(1);
  const showPagePicker = step === 0;
  // 正在请求分集数据时为 true，避免先闪现收藏夹列表再切换到选集步骤
  const needsFetchPages = Boolean(type === 2 && !isLocal && itemInfo?.bvid);
  const [isPagesLoading, setIsPagesLoading] = useState(false);

  useEffect(() => {
    if (!isFavSelectModalOpen) {
      setSelectedIds([]);
      setSelectedTagIds([]);
      setVideoPages([]);
      setPickedCid("whole");
      setStep(1);
      setIsPagesLoading(false);
      prevSelectedRef.current = [];
    } else {
      if (rid) {
        setSelectedTagIds(getItemTagIds(rid));
      }
      // 对多P视频提前进入加载态，防止收藏夹列表闪现
      if (needsFetchPages) {
        setIsPagesLoading(true);
      }
    }
  }, [isFavSelectModalOpen, rid, getItemTagIds, needsFetchPages]);

  // 获取多P视频分集列表，决定是否显示选集步骤
  useRequest(
    async () => {
      const bvid = itemInfo?.bvid;
      if (!bvid || type !== 2 || isLocal) return [];
      const res = await getWebInterfaceView({ bvid });
      return res?.data?.pages ?? [];
    },
    {
      ready: Boolean(isFavSelectModalOpen && type === 2 && !isLocal && itemInfo?.bvid),
      refreshDeps: [isFavSelectModalOpen, itemInfo?.bvid],
      onSuccess: pages => {
        setIsPagesLoading(false);
        if (pages && pages.length > 1) {
          setVideoPages(pages);
          // 若调用方传入了当前分集 cid，预选该分集；否则默认"整个视频"
          setPickedCid(itemInfo?.cid ?? "whole");
          setStep(0);
        }
      },
      onError: () => {
        setIsPagesLoading(false);
      },
    },
  );

  // 本地收藏夹的初始选中状态（选集步骤完成后再初始化）
  useEffect(() => {
    if (!isFavSelectModalOpen || !rid || showPagePicker) return;
    // 当有选集时，使用分集 cid 作为 localRid；否则用 aid (rid)
    const localRid = pickedCid !== "whole" ? pickedCid : rid;
    const localSelectedIds = localFolders
      .filter(f => (folderItems[f.id] ?? []).some(i => String(i.rid) === String(localRid)))
      .map(f => f.id);
    if (localSelectedIds.length) {
      setSelectedIds(prev => {
        const merged = Array.from(new Set([...prev, ...localSelectedIds]));
        prevSelectedRef.current = Array.from(new Set([...prevSelectedRef.current, ...localSelectedIds]));
        return merged;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFavSelectModalOpen, rid, showPagePicker, pickedCid]);

  const { data } = useRequest(
    async () => {
      if (!rid) return [];

      let list: any[] = [];
      if (type === 12) {
        const res = await getAudioCreatedFavList({
          rid: Number(rid),
          type: 12,
          up_mid: user?.mid as number,
          pn: 1,
          ps: 100,
        });
        list = res?.data?.list || [];
      } else {
        const res = await getFavFolderCreatedListAll({
          rid: Number(rid),
          type,
          up_mid: user?.mid as number,
        });
        list = res?.data?.list || [];
      }

      const selectedFavs = list.filter(item => item.fav_state === 1) || [];
      if (selectedFavs?.length) {
        const biliSelectedIds = selectedFavs.map(item => item.id);
        prevSelectedRef.current = Array.from(new Set([...prevSelectedRef.current, ...biliSelectedIds]));
        setSelectedIds(prev => Array.from(new Set([...prev, ...biliSelectedIds])));
      }

      return list;
    },
    {
      ready: Boolean(isFavSelectModalOpen && user?.mid && rid && !isLocal),
      refreshDeps: [isFavSelectModalOpen, rid],
    },
  );

  const toggle = (id: number) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]));
  };

  const handleCancel = () => {
    onFavSelectModalOpenChange(false);
  };

  const handleConfirm = async () => {
    if (!rid) return;

    // 区分 B站 收藏夹 ID（正数）和本地收藏夹 ID（负数）
    const localFolderIdSet = new Set(localFolders.map(f => f.id));

    // 计算分集信息（选了具体分集时生效）
    const pageInfo = pickedCid !== "whole" ? videoPages.find(p => String(p.cid) === pickedCid) : null;
    // 本地存储用的 rid：分集收藏时用 cid，整个视频时用 aid
    const localRid: string | number = pageInfo ? String(pageInfo.cid) : (rid as string | number);

    const biliPrevIds = prevSelectedRef.current.filter(id => !localFolderIdSet.has(id));
    const localPrevIds = localFolders
      .filter(f => (folderItems[f.id] ?? []).some(i => String(i.rid) === String(localRid)))
      .map(f => f.id);

    const biliSelectedIds = selectedIds.filter(id => !localFolderIdSet.has(id));
    const localSelectedIds = selectedIds.filter(id => localFolderIdSet.has(id));

    const biliDelIds = biliPrevIds.filter(id => !biliSelectedIds.includes(id)).join(",");
    const biliAddIds = biliSelectedIds.filter(id => !biliPrevIds.includes(id)).join(",");

    const localToAdd = localSelectedIds.filter(id => !localPrevIds.includes(id));
    const localToDel = localPrevIds.filter(id => !localSelectedIds.includes(id));

    try {
      setSubmitting(true);

      // 处理 B站 收藏夹（本地歌曲跳过）
      if (!isLocal && (biliAddIds || biliDelIds)) {
        let res: any;
        if (type === 12) {
          res = await postCollResourceDeal({
            rid,
            type: 12,
            add_media_ids: biliAddIds,
            del_media_ids: biliDelIds,
          });
        } else {
          res = await postFavFolderDeal({
            rid,
            add_media_ids: biliAddIds,
            del_media_ids: biliDelIds,
            type,
            platform: "web",
            ga: 1,
            gaia_source: "web_normal",
          });
        }
        if (res.code !== 0) {
          addToast({ title: res.message, color: "danger" });
          return;
        }
      }

      // 处理本地收藏夹
      for (const folderId of localToAdd) {
        if (itemInfo) {
          addLocalItem(folderId, {
            rid: localRid,
            type,
            source: itemInfo.source,
            title: pageInfo ? `${itemInfo.title}-P${pageInfo.page}` : itemInfo.title,
            cover: itemInfo.cover,
            bvid: itemInfo.bvid,
            audioUrl: itemInfo.audioUrl,
            ownerName: itemInfo.ownerName,
            ownerMid: itemInfo.ownerMid,
            duration: pageInfo?.duration ?? itemInfo.duration,
            playCount: itemInfo.playCount,
            // 分集信息
            cid: pageInfo ? String(pageInfo.cid) : undefined,
            page: pageInfo?.page,
            partTitle: pageInfo?.part,
          });
          // 更新收藏夹封面为最新添加的内容封面
          if (itemInfo.cover && !pageInfo) {
            const folder = useFavoritesStore.getState().createdFavorites.find(f => f.id === folderId);
            if (folder) {
              useFavoritesStore.getState().modifyCreatedFavorite({ ...folder, cover: itemInfo.cover });
            }
          }
        }
      }
      for (const folderId of localToDel) {
        removeLocalItem(folderId, localRid);
      }

      // 保存标签
      if (rid) {
        setItemTagsInStore(rid, selectedTagIds);
      }

      onFavSelectModalOpenChange(false);

      const totalPrevCount = biliPrevIds.length + localPrevIds.length;
      const totalSelectedCount = selectedIds.length;
      if (totalPrevCount === 0 && totalSelectedCount) {
        addToast({ title: "已添加到收藏夹", color: "success" });
      } else if (!totalSelectedCount) {
        addToast({ title: "已从收藏夹中移除", color: "success" });
      } else {
        addToast({ title: "修改成功", color: "success" });
      }

      // 刷新当前播放项的收藏状态
      const playItem = usePlayList.getState().getPlayItem();
      if (
        (playItem?.source === "local" && String(playItem?.id) === String(rid)) ||
        (playItem?.type === "audio" && String(playItem?.sid) === String(rid)) ||
        (playItem?.type === "mv" && String(playItem?.aid) === String(rid))
      ) {
        useMusicFavStore.getState().refreshIsFav();
      }

      onSuccess?.(selectedIds);
    } finally {
      setSubmitting(false);
    }
  };

  const allItems = [
    // 收藏具体分集时不显示 B站收藏夹（分集仅允许存入本地收藏夹）
    ...(pickedCid === "whole"
      ? (data ?? [])
          .filter(item => !hiddenMenuKeys.includes(String(item.id)))
          .map(item => ({ ...item, isLocal: false }))
      : []),
    ...localFolders.map(f => ({
      id: f.id,
      title: f.title,
      media_count: (folderItems[f.id] ?? []).length,
      isLocal: true,
    })),
  ];

  return (
    <Modal
      disableAnimation
      hideCloseButton
      backdrop="opaque"
      scrollBehavior="inside"
      shouldBlockScroll={false}
      isOpen={isFavSelectModalOpen}
      onOpenChange={onFavSelectModalOpenChange}
      isDismissable={false}
      size="md"
      radius="md"
      classNames={{
        backdrop: "z-200",
        wrapper: "z-200",
      }}
    >
      <ModalContent>
        <ModalHeader className="text-base font-medium">{title}</ModalHeader>
        <ModalBody className="px-0">
          {isPagesLoading ? (
            /* 等待分集数据，避免收藏夹列表闪现 */
            <div className="flex items-center justify-center py-10 text-sm text-zinc-400">加载中…</div>
          ) : showPagePicker ? (
            /* 选集步骤 */
            <ScrollContainer style={{ height: "100%" }}>
              <div className="flex flex-col gap-1 px-4">
                <RadioGroup value={pickedCid} onValueChange={setPickedCid}>
                  <Radio value="whole">
                    <span className="text-sm">收藏整个视频（共 {videoPages.length} 集）</span>
                  </Radio>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {videoPages.map(p => {
                      const isCurrentPage = itemInfo?.cid === String(p.cid);
                      return (
                        <Radio key={p.cid} value={String(p.cid)}>
                          <div className="flex min-w-0 items-center gap-2 py-0.5">
                            <span className="w-7 shrink-0 text-right text-xs text-zinc-400 tabular-nums">
                              P{p.page}
                            </span>
                            <span className="min-w-0 truncate text-sm">{p.part || itemInfo?.title}</span>
                            {isCurrentPage && (
                              <span className="bg-primary/15 text-primary ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs">
                                正在播放
                              </span>
                            )}
                            <span className="ml-auto shrink-0 text-xs text-zinc-400 tabular-nums">
                              <RiTimeLine size={11} className="mr-0.5 inline-block" />
                              {formatDuration(p.duration)}
                            </span>
                          </div>
                        </Radio>
                      );
                    })}
                  </div>
                </RadioGroup>
              </div>
            </ScrollContainer>
          ) : (
            /* 选收藏夹步骤 */
            <ScrollContainer style={{ height: "100%" }}>
              <div className="flex flex-col gap-1 overflow-auto px-4">
                {allItems.map(item => {
                  const checked = selectedIds.includes(item.id);
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      key={item.id}
                      onClick={() => toggle(item.id)}
                      onKeyDown={() => toggle(item.id)}
                      className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Checkbox
                        color="primary"
                        isSelected={checked}
                        onChange={() => toggle(item.id)}
                        onClick={e => e.stopPropagation()}
                        aria-label={item.title}
                        isDisabled={item.isLocal && !itemInfo}
                      />
                      <div className="flex min-w-0 flex-1 items-center justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{item.title}</div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            {item.media_count ?? 0} 个内容
                            {item.isLocal && (
                              <span className="ml-1 rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-700">
                                本地
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {allTags.length > 0 && (
                <div className="px-4 pt-3">
                  <Divider className="mb-3" />
                  <div className="mb-2 text-sm font-medium text-zinc-500">标签</div>
                  <div className="flex flex-wrap gap-1.5">
                    {allTags.map(tag => {
                      const selected = selectedTagIds.includes(tag.id);
                      return (
                        <Chip
                          key={tag.id}
                          variant={selected ? "flat" : "bordered"}
                          style={
                            selected
                              ? { backgroundColor: tag.color + "22", color: tag.color }
                              : { borderColor: tag.color + "66", color: tag.color }
                          }
                          className="cursor-pointer"
                          startContent={selected ? <RiCheckLine size={12} /> : undefined}
                          onClick={() =>
                            setSelectedTagIds(prev =>
                              prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id],
                            )
                          }
                        >
                          {tag.name}
                        </Chip>
                      );
                    })}
                  </div>
                </div>
              )}
            </ScrollContainer>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={handleCancel} isDisabled={submitting}>
            取消
          </Button>
          {isPagesLoading ? (
            <Button color="primary" isDisabled>
              下一步
            </Button>
          ) : showPagePicker ? (
            <Button color="primary" onPress={() => setStep(1)}>
              下一步
            </Button>
          ) : (
            <AsyncButton
              color="primary"
              onPress={handleConfirm}
              isDisabled={
                hasSameIds(selectedIds, prevSelectedRef.current) &&
                hasSameIds(selectedTagIds, rid ? getItemTagIds(rid) : [])
              }
            >
              确认
            </AsyncButton>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default FavoritesSelectModal;
