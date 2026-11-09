import type { Platform } from "../../src/platform/types";

import { markPlatformReady } from "../../src/platform/ready";
import { updateWebSyncSafety } from "../../src/platform/web-sync-safety";
import { beginSyncRequest, finishSyncRequest, refreshSyncSafety } from "../../src/service/sync/safety";

const output = document.querySelector("pre")!;
let failHold = false;
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("biu-sandbox-web-store", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("stores");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
markPlatformReady({
  syncSafety: async action => {
    if (failHold && action.kind === "finish" && action.signal) throw new Error("fixture disk quota");
    return updateWebSyncSafety(await database, action);
  },
} as Platform);

document.querySelector("#fail")!.addEventListener("click", async () => {
  try {
    const id = crypto.randomUUID();
    await beginSyncRequest(id);
    failHold = true;
    await finishSyncRequest(id, 429);
  } catch {
    const saved = await updateWebSyncSafety(await database, { kind: "read" });
    output.textContent = JSON.stringify(
      {
        scenario: "first429_hold_write_failed",
        durablePending: Object.keys(saved.pending ?? {}).length,
        persistedHold: saved.hold,
        view: await refreshSyncSafety(),
      },
      null,
      2,
    );
  }
});
document.querySelector("#check")!.addEventListener("click", async () => {
  const id = crypto.randomUUID();
  try {
    await beginSyncRequest(id);
    await finishSyncRequest(id);
    output.textContent = JSON.stringify({ permitted: true });
  } catch {
    output.textContent = JSON.stringify({ permitted: false, view: await refreshSyncSafety() }, null, 2);
  }
});

document.querySelector("#pending")?.addEventListener("click", async () => {
  await beginSyncRequest(crypto.randomUUID());
  output.textContent = JSON.stringify({ scenario: "live_request", view: await refreshSyncSafety() }, null, 2);
});
