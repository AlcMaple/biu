import { create } from "zustand";

import { platformReady } from "@/platform/ready";

import { createSyncSafetyGate, SyncPausedError, type SyncContext, type SyncSafetyView } from "./safety-gate";

export { isSyncPausedError } from "./safety-gate";
export const useSyncSafetyView = create<SyncSafetyView>()(() => ({ abandonedIds: [] }));
const resumed = new Set<() => void>();
const ownerPrefix = "biu-sync-owner:";
let contextPromise: Promise<SyncContext> | undefined;

function context(): Promise<SyncContext> {
  if (contextPromise) return contextPromise;
  const created = new Promise<SyncContext>((resolve, reject) => {
    if (!navigator.locks || !crypto.randomUUID) {
      reject(new SyncPausedError("当前环境不支持跨页面同步保护，自动同步未启动"));
      return;
    }
    const owner = crypto.randomUUID();
    // 页面锁标识存活者，不占网络锁；长通知不会挡住普通请求。
    const finished = navigator.locks.request(
      ownerPrefix + owner,
      () =>
        new Promise<void>(release => {
          resolve({
            owner,
            liveOwners: async () =>
              new Set(
                (await navigator.locks.query()).held
                  ?.map(lock => lock.name ?? "")
                  .filter(name => name.startsWith(ownerPrefix))
                  .map(name => name.slice(ownerPrefix.length)),
              ),
            retire: async () => {
              // 暂停写盘失败时主动撤销存活资格，其他页面也会识别盘上未结请求，不依赖内存广播。
              release();
              await finished;
              if (contextPromise === created) contextPromise = undefined;
            },
          });
        }),
    );
    void finished.catch(reject);
  });
  contextPromise = created;
  return created;
}

let observedResume: number | undefined;

const gate = createSyncSafetyGate(
  async action => (await platformReady).syncSafety(action),
  context,
  view => {
    useSyncSafetyView.setState(view, true);
    if (!view.state) return;
    const revision = view.state.resumedAtRevision ?? 0;
    const changed = observedResume !== undefined && revision > observedResume;
    observedResume = Math.max(observedResume ?? 0, revision);
    if (changed && !view.error && !view.state.hold && !view.abandonedIds.length) {
      for (const listener of resumed) listener();
    }
  },
);

export const refreshSyncSafety = gate.read;
export const beginSyncRequest = gate.begin;
export const finishSyncRequest = gate.finish;
export const abandonSyncRequest = gate.abandon;

export async function resumeSyncSafety(expectedRevision: number) {
  const done = await gate.resume(expectedRevision);
  return done;
}

export function onSyncSafetyResumed(listener: () => void) {
  resumed.add(listener);
  return () => {
    resumed.delete(listener);
  };
}
