import { create } from "zustand";
import { persist } from "zustand/middleware";

import platform, { isWeb } from "@/platform";
import { getUserInfo, type UserInfo } from "@/service/user-info";
import { StoreNameMap } from "@shared/store";

interface UserState {
  user: UserInfo | null;
}

interface Action {
  updateUser: () => Promise<void>;
  clear: () => void;
}

const updateBrowserMonitoringUser = (user: UserInfo | null) => {
  if (!isWeb) return;
  window.__biuMonitoring?.setUser(
    user
      ? {
          id: String(user.mid),
          ...(user.uname ? { username: user.uname } : {}),
        }
      : null,
  );
};

export const useUser = create<UserState & Action>()(
  persist(
    set => ({
      user: null,
      updateUser: async () => {
        const res = await getUserInfo();
        const user = res.code === 0 && res.data?.isLogin ? res.data : null;

        set(() => ({ user }));
        updateBrowserMonitoringUser(user);
      },
      clear: () => {
        set(() => ({
          user: null,
        }));
        updateBrowserMonitoringUser(null);
      },
    }),
    {
      name: "user",
      partialize: state => state.user,
      storage: {
        getItem: async () => {
          const store = await platform.getStore(StoreNameMap.UserLoginInfo);

          return {
            state: store,
          };
        },

        setItem: async (_, value) => {
          if (value.state) {
            await platform.setStore(StoreNameMap.UserLoginInfo, value.state);
          }
        },

        removeItem: async () => {
          await platform.clearStore(StoreNameMap.UserLoginInfo);
        },
      },
    },
  ),
);
