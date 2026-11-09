import {
  readSyncSafetyState,
  updateSyncSafetyState,
  type SyncSafetyAction,
  type SyncSafetyState,
} from "@shared/sync-safety";

export function updateWebSyncSafety(database: IDBDatabase, action: SyncSafetyAction): Promise<SyncSafetyState> {
  return new Promise((resolve, reject) => {
    // 与普通get/set分开：读取版本、比对和保存必须在同一个事务，跨标签才不会覆盖新暂停。
    const transaction = database.transaction("stores", action.kind === "read" ? "readonly" : "readwrite");
    const store = transaction.objectStore("stores");
    const request = store.get("sync-safety");
    let next: SyncSafetyState;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const current = readSyncSafetyState(request.result);
        next = updateSyncSafetyState(current, action);
        if (next.revision !== current.revision) store.put(next, "sync-safety");
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onerror = transaction.onabort = () =>
      reject(failure ?? new Error("同步暂停记录读写失败，请检查设备存储"));
  });
}
