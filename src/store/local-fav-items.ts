import { create } from "zustand";
import { persist } from "zustand/middleware";

import platform from "@/platform";
import { StoreNameMap } from "@shared/store";

/** 本地收藏夹中的媒体项 */
export interface LocalFavItem {
  /** 资源 id（视频为 aid，音频为 sid；本地音乐为文件 id；分集收藏时为 cid） */
  rid: string | number;
  /** 2=视频 12=音频 */
  type: number;
  /** 来源：local=本地文件 online=B站在线资源 */
  source?: "local" | "online";
  title: string;
  cover?: string;
  /** 视频 bvid（type=2 且 online 时用于播放） */
  bvid?: string;
  /** 本地音频文件 URL（source=local 时用于播放） */
  audioUrl?: string;
  ownerName?: string;
  ownerMid?: number;
  fav_time: number;
  /** 时长（秒数或格式化字符串） */
  duration?: number | string;
  /** 播放量 */
  playCount?: number;
  /** 分集 cid（仅当收藏的是多P视频的某一集时存在，rid 也会设为该 cid） */
  cid?: string;
  /** 分集序号（从 1 开始） */
  page?: number;
  /** 分集标题 */
  partTitle?: string;
  /** 用户自定义歌手（覆盖 ownerName 显示，目前仅作用于精美播放器） */
  customArtist?: string;
  /**
   * 资源已失效（B站侧被删除/下架）。检测时机为打开收藏夹时后台批量查询。
   * 失效项保留在收藏夹中供用户辨认，但会被各播放入口跳过，避免播放卡住。
   */
  invalid?: boolean;
}

interface State {
  /** folderId -> items */
  folderItems: Record<number, LocalFavItem[]>;
}

interface Action {
  addItem: (folderId: number, item: Omit<LocalFavItem, "fav_time">) => void;
  removeItem: (folderId: number, rid: string | number) => void;
  renameItem: (folderId: number, rid: string | number, newTitle: string) => void;
  hasItem: (folderId: number, rid: string | number) => boolean;
  getItems: (folderId: number) => LocalFavItem[];
  getItemCount: (folderId: number) => number;
  clearFolder: (folderId: number) => void;
  /** 将 fromId 收藏夹的条目并入 toId（按 rid 去重、保留各自原 fav_time），并移除 fromId */
  mergeFolder: (fromId: number, toId: number) => void;
  /** 跨所有收藏夹按 rid 设置自定义歌手 */
  setCustomArtistByRid: (rid: string | number, artist: string | undefined) => void;
  /**
   * 按检测结果刷新失效标记：checkedRids 中的项，命中 invalidRids 则标记失效，
   * 否则清除标记（资源恢复有效时摘掉旧标记）；未检测到的项保持原状。
   */
  updateInvalidFlags: (folderId: number, invalidRids: Set<string>, checkedRids: Set<string>) => void;
}

export const useLocalFavItemsStore = create<State & Action>()(
  persist(
    (set, get) => ({
      folderItems: {},
      addItem: (folderId, item) =>
        set(state => {
          const current = state.folderItems[folderId] ?? [];
          const existingIndex = current.findIndex(i => String(i.rid) === String(item.rid));
          if (existingIndex !== -1) {
            // 已存在时，更新 source/audioUrl 等可能缺失的字段（兼容旧数据）
            const updated = [...current];
            updated[existingIndex] = { ...updated[existingIndex], source: item.source, audioUrl: item.audioUrl };
            return { folderItems: { ...state.folderItems, [folderId]: updated } };
          }
          return {
            folderItems: {
              ...state.folderItems,
              [folderId]: [{ ...item, fav_time: Date.now() }, ...current],
            },
          };
        }),
      removeItem: (folderId, rid) =>
        set(state => ({
          folderItems: {
            ...state.folderItems,
            [folderId]: (state.folderItems[folderId] ?? []).filter(i => String(i.rid) !== String(rid)),
          },
        })),
      renameItem: (folderId, rid, newTitle) =>
        set(state => ({
          folderItems: {
            ...state.folderItems,
            [folderId]: (state.folderItems[folderId] ?? []).map(i =>
              String(i.rid) === String(rid) ? { ...i, title: newTitle } : i,
            ),
          },
        })),
      hasItem: (folderId, rid) => {
        const items = get().folderItems[folderId] ?? [];
        return items.some(i => String(i.rid) === String(rid));
      },
      getItems: folderId => get().folderItems[folderId] ?? [],
      getItemCount: folderId => (get().folderItems[folderId] ?? []).length,
      clearFolder: folderId =>
        set(state => {
          const next = { ...state.folderItems };
          delete next[folderId];
          return { folderItems: next };
        }),
      mergeFolder: (fromId, toId) =>
        set(state => {
          if (fromId === toId) return {};
          const from = state.folderItems[fromId];
          if (!from) return {};
          const to = state.folderItems[toId] ?? [];
          const seen = new Set(to.map(i => String(i.rid)));
          const merged = [...to, ...from.filter(i => !seen.has(String(i.rid)))];
          const next = { ...state.folderItems, [toId]: merged };
          delete next[fromId];
          return { folderItems: next };
        }),
      updateInvalidFlags: (folderId, invalidRids, checkedRids) =>
        set(state => {
          const current = state.folderItems[folderId];
          if (!current?.length) return {};
          let changed = false;
          const updated = current.map(item => {
            const rid = String(item.rid);
            if (!checkedRids.has(rid)) return item;
            const invalid = invalidRids.has(rid) ? true : undefined;
            if (item.invalid === invalid) return item;
            changed = true;
            return { ...item, invalid };
          });
          if (!changed) return {};
          return { folderItems: { ...state.folderItems, [folderId]: updated } };
        }),
      setCustomArtistByRid: (rid, artist) =>
        set(state => {
          let changed = false;
          const next: Record<number, LocalFavItem[]> = {};
          for (const [folderIdStr, items] of Object.entries(state.folderItems)) {
            next[Number(folderIdStr)] = items.map(i => {
              if (String(i.rid) === String(rid)) {
                changed = true;
                return { ...i, customArtist: artist };
              }
              return i;
            });
          }
          return changed ? { folderItems: next } : {};
        }),
    }),
    {
      name: "local-fav-items",
      storage: {
        getItem: async () => {
          const store = await platform.getStore(StoreNameMap.LocalFavItems);
          return store ? { state: store } : null;
        },
        setItem: async (_, value) => {
          if (value.state) {
            await platform.setStore(StoreNameMap.LocalFavItems, value.state);
          }
        },
        removeItem: async () => {
          await platform.clearStore(StoreNameMap.LocalFavItems);
        },
      },
      partialize: state => ({ folderItems: state.folderItems }),
    },
  ),
);
