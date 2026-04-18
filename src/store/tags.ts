import { create } from "zustand";
import { persist } from "zustand/middleware";

import platform from "@/platform";
import { StoreNameMap } from "@shared/store";

export interface Tag {
  id: number;
  name: string;
  color: string;
}

interface State {
  tags: Tag[];
  /** String(rid) -> tag id[] */
  itemTags: Record<string, number[]>;
}

interface Action {
  addTag: (name: string, color: string) => void;
  removeTag: (id: number) => void;
  getItemTagIds: (rid: string | number) => number[];
  setItemTags: (rid: string | number, tagIds: number[]) => void;
}

export const useTagStore = create<State & Action>()(
  persist(
    (set, get) => ({
      tags: [],
      itemTags: {},
      addTag: (name, color) =>
        set(state => ({
          tags: [...state.tags, { id: Date.now(), name, color }],
        })),
      removeTag: id =>
        set(state => {
          const itemTags: Record<string, number[]> = {};
          for (const key of Object.keys(state.itemTags)) {
            const filtered = state.itemTags[key].filter(t => t !== id);
            if (filtered.length) {
              itemTags[key] = filtered;
            }
          }
          return {
            tags: state.tags.filter(t => t.id !== id),
            itemTags,
          };
        }),
      getItemTagIds: rid => get().itemTags[String(rid)] ?? [],
      setItemTags: (rid, tagIds) =>
        set(state => {
          const itemTags = { ...state.itemTags };
          if (tagIds.length) {
            itemTags[String(rid)] = tagIds;
          } else {
            delete itemTags[String(rid)];
          }
          return { itemTags };
        }),
    }),
    {
      name: "tags",
      storage: {
        getItem: async () => {
          const store = await platform.getStore(StoreNameMap.Tags);
          return store ? { state: store } : null;
        },
        setItem: async (_, value) => {
          if (value.state) {
            await platform.setStore(StoreNameMap.Tags, value.state);
          }
        },
        removeItem: async () => {
          await platform.clearStore(StoreNameMap.Tags);
        },
      },
      partialize: state => ({ tags: state.tags, itemTags: state.itemTags }),
    },
  ),
);
