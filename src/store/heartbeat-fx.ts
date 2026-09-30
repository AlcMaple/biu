import { create } from "zustand";
import { persist } from "zustand/middleware";

interface HeartbeatFxState {
  /** 简化特效：关闭粒子星云的重绘与发光叠加，低配机器/省电用 */
  lite: boolean;
  setLite: (lite: boolean) => void;
}

export const useHeartbeatFx = create<HeartbeatFxState>()(
  persist(
    set => ({
      lite: false,
      setLite: lite => set({ lite }),
    }),
    { name: "heartbeat-fx" },
  ),
);
