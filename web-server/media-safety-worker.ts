import { parentPort, workerData } from "node:worker_threads";

import { MediaSafetyPausedError, MediaSafetyStore } from "./media-safety-store.js";
import { isMediaSafetyWorkerRequest, type MediaSafetyWorkerReply } from "./media-safety-worker-protocol.js";

const port = parentPort;
if (!port || typeof workerData !== "object" || typeof workerData?.file !== "string")
  throw new Error("invalid media safety worker configuration");
let store: MediaSafetyStore | undefined;
let failed = false;
port.on("message", (request: unknown) => {
  if (!isMediaSafetyWorkerRequest(request)) throw new Error("invalid media safety worker operation");
  const id = request.id;
  let reply: MediaSafetyWorkerReply;
  try {
    if (failed) throw new MediaSafetyPausedError("storage");
    store ??= new MediaSafetyStore(workerData.file);
    switch (request.method) {
      case "begin":
        reply = { id, ok: true, admission: store.begin() };
        break;
      case "finish":
        store.finish(request.admission, request.status, request.riskControl);
        reply = { id, ok: true };
        break;
      case "abandon":
        store.abandon(request.admission);
        reply = { id, ok: true };
        break;
    }
  } catch (error) {
    const reason = error instanceof MediaSafetyPausedError ? error.reason : "storage";
    if (reason === "storage") failed = true;
    reply = { id, ok: false, reason: reason ?? "storage" };
  }
  port.postMessage(reply);
});
