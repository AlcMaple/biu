import { create } from "zustand";
import { persist } from "zustand/middleware";

import { StoreNameMap } from "@shared/store";

/** 本地收藏夹中的媒体项 */
export interface LocalFavItem {
  /** 资源 id（视频为 aid，音频为 sid；本地音乐为文件 id） */
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
    }),
    {
      name: "local-fav-items",
      storage: {
        getItem: async () => {
          const store = await window.electron.getStore(StoreNameMap.LocalFavItems);
          return store ? { state: store } : null;
        },
        setItem: async (_, value) => {
          if (value.state) {
            await window.electron.setStore(StoreNameMap.LocalFavItems, value.state);
          }
        },
        removeItem: async () => {
          await window.electron.clearStore(StoreNameMap.LocalFavItems);
        },
      },
      partialize: state => ({ folderItems: state.folderItems }),
    },
  ),
);
