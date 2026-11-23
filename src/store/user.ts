import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createTestUser, isTestAccount } from "@/common/constants/test-account";
import platform, { isWeb } from "@/platform";
import { platformReady } from "@/platform/ready";
import { getUserInfo, type UserInfo } from "@/service/user-info";
import { StoreNameMap } from "@shared/store";

interface UserState {
  user: UserInfo | null;
}

interface Action {
  updateUser: () => Promise<void>;
  loginAsTestAccount: () => void;
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

let userRequest = 0;

export const useUser = create<UserState & Action>()(
  persist(
    (set, get) => ({
      user: null,
      updateUser: async () => {
        // 测试账号没有 B 站登录态，启动时的刷新会把它当成未登录清掉
        if (isTestAccount(get().user)) return;
        const request = ++userRequest;
        const res = await getUserInfo();
        if (request !== userRequest) return;
        const user = res.code === 0 && res.data?.isLogin ? res.data : null;

        set(() => ({ user }));
        updateBrowserMonitoringUser(user);
      },
      loginAsTestAccount: () => {
        userRequest++;
        const user = createTestUser();
        set(() => ({ user }));
      },
      clear: () => {
        userRequest++;
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
          const readyPlatform = await platformReady;
          const store = await readyPlatform.getStore(StoreNameMap.UserLoginInfo);

          return {
            state: store,
          };
        },

        setItem: async (_, value) => {
          if (value.state) {
            await platform.setStore(StoreNameMap.UserLoginInfo, value.state);
          } else {
            await platform.clearStore(StoreNameMap.UserLoginInfo);
          }
        },

        removeItem: async () => {
          await platform.clearStore(StoreNameMap.UserLoginInfo);
        },
      },
    },
  ),
);
