import { create } from "zustand";

import { isOfflineDemo } from "@/common/offline-demo";
import platform from "@/platform";
import type { PlaylistStoreName } from "@shared/store";

export const usePlaylistSession = create(() => ({
  mid: null as number | null,
  ready: false,
  canClaim: false,
  error: "",
}));

export async function readPlaylistStore(name: PlaylistStoreName) {
  const session = usePlaylistSession.getState();
  if (!session.mid && !isOfflineDemo) return undefined;
  const value = await platform.getStore(name, session.mid ?? undefined);
  if (session !== usePlaylistSession.getState()) throw new Error("账号已切换，放弃之前的歌单读取");
  return value;
}

export function writePlaylistStore(name: PlaylistStoreName, value: StoreDataMap[PlaylistStoreName]) {
  const { mid, ready } = usePlaylistSession.getState();
  if ((mid && ready) || isOfflineDemo) return platform.setStore(name, value, mid ?? undefined);
}

export function clearPlaylistStore(name: PlaylistStoreName) {
  const { mid, ready } = usePlaylistSession.getState();
  if ((mid && ready) || isOfflineDemo) return platform.clearStore(name, mid ?? undefined);
}

// persist 读完文件后还会跨几个微任务才合并。就在合并处核对读取批次，覆盖 A→B→A 的切换。
const hydrationOwner = Symbol("playlist hydration");
const hydrationErrors = new WeakMap<ReturnType<typeof usePlaylistSession.getState>, Error>();

export function playlistReadError(session: ReturnType<typeof usePlaylistSession.getState>) {
  return hydrationErrors.get(session);
}

export async function readPlaylistState(name: PlaylistStoreName): Promise<{ state: Record<string, unknown> } | null> {
  const owner = usePlaylistSession.getState();
  try {
    const data = await readPlaylistStore(name);
    return data ? { state: { ...data, [hydrationOwner]: owner } } : null;
  } catch (error) {
    // Zustand 吞掉 rehydrate 异常，hasHydrated 又可能被上一次登录的读取更新。
    hydrationErrors.set(owner, error instanceof Error ? error : new Error("读取本地歌单失败"));
    throw error;
  }
}

export function mergePlaylistState<T>(saved: unknown, current: T): T {
  if (!saved || typeof saved !== "object" || !(hydrationOwner in saved)) return current;
  const { [hydrationOwner]: owner, ...data } = saved;
  return owner === usePlaylistSession.getState() ? { ...current, ...data } : current;
}
