import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SearchItem {
  value: string;
  time: number;
}

export interface SearchHistoryState {
  keyword: string;
  items: SearchItem[];
  // 相同关键词也要重新发起搜索；只在当前页面内递增，不参与持久化
  searchRevision: number;
}

export interface SearchHistoryAction {
  add: (value: string) => void;
  delete: (item: SearchItem) => void;
  clear: () => void;
}

export const useSearchHistory = create<SearchHistoryState & SearchHistoryAction>()(
  persist(
    (set, get) => ({
      keyword: "",
      items: [],
      searchRevision: 0,
      add: value => {
        const { items, searchRevision } = get();
        const newItem = { value, time: Date.now() };

        if (items.some(i => i.value === value)) {
          set({
            keyword: value,
            items: [newItem, ...items.filter(i => i.value !== value)],
            searchRevision: searchRevision + 1,
          });
        } else {
          set({ keyword: value, items: [newItem, ...items], searchRevision: searchRevision + 1 });
        }
      },
      delete: item => set(state => ({ items: state.items.filter(i => i.value !== item.value) })),
      clear: () => set({ keyword: "", items: [] }),
    }),
    {
      name: "search-history",
      partialize: state => ({ keyword: state.keyword, items: state.items }),
    },
  ),
);
