import { create } from "zustand";
import { persist } from "zustand/middleware";

import platform from "@/platform";
import { defaultAppSettings } from "@shared/settings/app-settings";
import { StoreNameMap } from "@shared/store";

interface SettingsActions {
  getSettings: () => AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

export const useSettings = create<AppSettings & SettingsActions>()(
  persist(
    (set, get) => ({
      ...defaultAppSettings,
      getSettings: () => {
        return Object.keys(defaultAppSettings).reduce((acc, key) => {
          acc[key] = get()[key];
          return acc;
        }, {} as AppSettings);
      },
      update: (patch: Partial<AppSettings>) => {
        set(patch);
      },
      reset: () => {
        set(defaultAppSettings);
      },
    }),
    {
      name: "settings",
      storage: {
        getItem: async () => {
          const store = await platform.getStore(StoreNameMap.AppSettings);

          // 兼容之前的错误默认值
          if (store?.appSettings?.fontFamily === "system-default") {
            store.appSettings.fontFamily = "system-ui";
          }

          return {
            state: store?.appSettings,
          };
        },

        setItem: async (_, value) => {
          if (value.state) {
            await platform.setStore(StoreNameMap.AppSettings, {
              appSettings: value.state,
            });
          }
        },

        removeItem: async () => {
          await platform.clearStore(StoreNameMap.AppSettings);
        },
      },
      partialize: state => {
        return {
          downloadPath: state.downloadPath,
          closeWindowOption: state.closeWindowOption,
          autoStart: state.autoStart,
          fontFamily: state.fontFamily,
          primaryColor: state.primaryColor,
          backgroundColor: state.backgroundColor,
          borderRadius: state.borderRadius,
          audioQuality: state.audioQuality,
          hiddenMenuKeys: state.hiddenMenuKeys,
          displayMode: state.displayMode,
          ffmpegPath: state.ffmpegPath,
          themeMode: state.themeMode,
          pageTransition: state.pageTransition,
          showSearchHistory: state.showSearchHistory,
          proxySettings: state.proxySettings,
          sideMenuCollapsed: state.sideMenuCollapsed,
          sideMenuWidth: state.sideMenuWidth,
          sideMenuCollectionFolded: state.sideMenuCollectionFolded,
          reportPlayHistory: state.reportPlayHistory,
          localMusicDirs: state.localMusicDirs,
        };
      },
    },
  ),
);
