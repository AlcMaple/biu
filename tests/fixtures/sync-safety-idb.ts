import { updateWebSyncSafety } from "../../src/platform/web-sync-safety";
const output = document.querySelector("pre")!;
const result: { name: string; ok: boolean }[] = [];
function assert(name: string, value: boolean) {
  result.push({ name, ok: value });
  output.textContent = JSON.stringify(result, null, 2);
  if (!value) throw new Error(name);
}
const databaseName = `biu-sync-safety-engineering-${Date.now()}`;
function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("stores");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
document.querySelector("button")!.addEventListener("click", async () => {
  (document.querySelector("button") as HTMLButtonElement).disabled = true;
  try {
    const a = await open();
    let b = await open();
    assert("missing record is explicitly unpaused", (await updateWebSyncSafety(a, { kind: "read" })).revision === 0);
    const first = await updateWebSyncSafety(a, { kind: "hold", signal: 503, at: 1 });
    assert("hold commits before resolving", first.revision === 1 && first.hold?.signal === 503);
    assert(
      "second connection sees committed pause",
      (await updateWebSyncSafety(b, { kind: "read" })).hold?.signal === 503,
    );
    const [newer, stale] = await Promise.all([
      updateWebSyncSafety(a, { kind: "hold", signal: 429, at: 2 }),
      updateWebSyncSafety(b, { kind: "resume", expectedRevision: 1 }),
    ]);
    assert(
      "stale recovery cannot clear concurrent newer hold",
      newer.revision === 2 && stale.revision === 2 && stale.hold?.signal === 429,
    );
    b.close();
    b = await open();
    assert("reopen retains hold", (await updateWebSyncSafety(b, { kind: "read" })).revision === 2);
    const failing = {
      transaction: (...args: Parameters<IDBDatabase["transaction"]>) => {
        const tx = a.transaction(...args);
        const original = tx.objectStore.bind(tx);
        tx.objectStore = (name: string) => {
          const store = original(name);
          store.put = () => {
            throw new DOMException("fixture quota", "QuotaExceededError");
          };
          return store;
        };
        return tx;
      },
    } as IDBDatabase;
    let rejected = false;
    try {
      await updateWebSyncSafety(failing, { kind: "resume", expectedRevision: 2 });
    } catch {
      rejected = true;
    }
    const kept = await updateWebSyncSafety(b, { kind: "read" });
    assert(
      "failed recovery aborts transaction and retains pause",
      rejected && kept.revision === 2 && kept.hold?.signal === 429,
    );
    const resumed = await updateWebSyncSafety(a, { kind: "resume", expectedRevision: 2 });
    assert("explicit current-version recovery commits", resumed.revision === 3 && resumed.hold === null);
    await updateWebSyncSafety(b, { kind: "hold", signal: 412, at: 3 });
    const late = await updateWebSyncSafety(a, { kind: "resume", expectedRevision: 3 });
    assert("late fault survives prior recovery confirmation", late.revision === 4 && late.hold?.signal === 412);
    await new Promise<void>((resolve, reject) => {
      const tx = a.transaction("stores", "readwrite");
      tx.objectStore("stores").put(null, "sync-safety");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    rejected = false;
    try {
      await updateWebSyncSafety(b, { kind: "read" });
    } catch {
      rejected = true;
    }
    assert("corrupt persisted record rejects instead of resetting", rejected);
    a.close();
    b.close();
    output.textContent = JSON.stringify({ complete: true, passed: result.length, checks: result }, null, 2);
  } catch (error) {
    output.textContent = JSON.stringify({ complete: false, checks: result, error: String(error) }, null, 2);
  }
});
