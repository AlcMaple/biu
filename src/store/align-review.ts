import { create } from "zustand";

import { log } from "@/platform";
import { getAlignMe, getReviewList } from "@/service/lyrics-align";

interface AlignReviewState {
  isAdmin: boolean;
  pendingCount: number;
  refresh: () => Promise<void>;
  reset: () => void;
}

// 窗口切回前台时最多这么久查一次，来回切窗口不至于每次都打两个请求
const FOCUS_REFRESH_MIN_INTERVAL_MS = 60_000;
let lastRefreshAt = 0;

// 只在登录、窗口切回前台、进审核页、审核操作后刷新，不定时轮询：对齐服务按 mid 限流，待审数量也不需要秒级
export const useAlignReview = create<AlignReviewState>(set => ({
  isAdmin: false,
  pendingCount: 0,
  refresh: async () => {
    lastRefreshAt = Date.now();
    try {
      const me = await getAlignMe();
      if (!me.isAdmin) {
        set({ isAdmin: false, pendingCount: 0 });
        return;
      }
      const { items } = await getReviewList("pending");
      set({ isAdmin: true, pendingCount: items.length });
    } catch (err) {
      // 服务不可用时只是暂时不显示审核入口；审核页里会把具体错误原样展示
      log.warn("[lyrics-review] 查询审核员身份 / 待审数量失败", err);
    }
  },
  reset: () => set({ isAdmin: false, pendingCount: 0 }),
}));

export const refreshAlignReviewOnFocus = () => {
  if (Date.now() - lastRefreshAt < FOCUS_REFRESH_MIN_INTERVAL_MS) return;
  void useAlignReview.getState().refresh();
};
