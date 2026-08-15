import moment from "moment";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

import { isWeb } from "@/platform/detect";

interface TokenState {
  /** 刷新 cookie 使用 */
  tokenData?: {
    refresh_token?: string;
  };
  /** 下次检测刷新时间 */
  nextCheckRefreshTime?: number;
}

interface Action {
  updateToken: (info: Partial<TokenState>) => void;
  clear: () => void;
}

const clearLegacyWebToken = (name: string) => {
  try {
    window.localStorage.removeItem(name);
  } catch {
    // 无存储权限时保持内存态即可；Web 登录凭据仍只存在服务端。
  }
};

const webSessionOnlyStorage: StateStorage = {
  getItem: name => {
    clearLegacyWebToken(name);
    return null;
  },
  setItem: name => clearLegacyWebToken(name),
  removeItem: name => clearLegacyWebToken(name),
};

const tokenPersistOptions = isWeb
  ? { name: "user-token", storage: createJSONStorage(() => webSessionOnlyStorage) }
  : { name: "user-token" };

export const useToken = create<TokenState & Action>()(
  persist(
    set => ({
      tokenData: {},
      nextCheckRefreshTime: moment().unix(),
      updateToken: async (info: Partial<TokenState>) => {
        set(state => ({ ...state, ...info }));
      },
      clear: () => {
        set({
          tokenData: undefined,
          nextCheckRefreshTime: undefined,
        });
      },
    }),
    {
      ...tokenPersistOptions,
      partialize: state => ({
        tokenData: state.tokenData,
        nextCheckRefreshTime: state.nextCheckRefreshTime,
      }),
    },
  ),
);
