import type { Platform } from "./types";

let resolveReady: (platform: Platform) => void;

// 用户 store 位于平台层的循环依赖中，首次 hydration 只在完整的平台实现就绪后读取。
export const platformReady = new Promise<Platform>(resolve => {
  resolveReady = resolve;
});

export const markPlatformReady = (platform: Platform) => resolveReady(platform);
