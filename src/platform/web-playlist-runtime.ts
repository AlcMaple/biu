import type { PlaylistPartitionData, PlaylistPartitionStore } from "./web-playlist-partition";

import { createPlaylistSession, playlistScope } from "./web-playlist-partition";

type PlaylistSession = ReturnType<typeof createPlaylistSession>;

let session: PlaylistSession | undefined;
let resolveReady: (session: PlaylistSession) => void;
let rejectReady: (error: unknown) => void;
const ready = new Promise<PlaylistSession>((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});
void ready.catch(() => undefined);
const writes = new Set<Promise<void>>();
const listeners = new Set<(error: Error) => void>();
let writeError: Error | undefined;

export function startWebPlaylistSession(store: PlaylistPartitionStore, mid: number | null) {
  const scope = playlistScope(mid);
  if (session) {
    if (session.scope !== scope) throw new Error("身份已变化，请重新载入收藏");
    return session;
  }
  session = createPlaylistSession(store, scope);
  resolveReady(session);
  return session;
}

export function failWebPlaylistStartup(error: unknown) {
  rejectReady(error);
}

export function onWebPlaylistWriteError(listener: (error: Error) => void) {
  listeners.add(listener);
  if (writeError) listener(writeError);
  return () => {
    listeners.delete(listener);
  };
}

export async function readWebPlaylistPartition<K extends keyof PlaylistPartitionData>(name: K) {
  const captured = await ready;
  return (await captured.read())[name];
}

export function writeWebPlaylistPartition<K extends keyof PlaylistPartitionData>(
  name: K,
  value: PlaylistPartitionData[K],
) {
  const copy = structuredClone(value);
  const captured = session;
  const operation = (async () => {
    const target = captured ?? (await ready);
    await target.write(name, copy);
  })();
  const tracked = operation.catch(error => {
    writeError = error instanceof Error ? error : new Error("收藏保存失败");
    listeners.forEach(listener => listener(writeError!));
  });
  writes.add(tracked);
  void tracked.finally(() => writes.delete(tracked));
  return tracked;
}

export async function flushWebPlaylistWrites() {
  while (writes.size) await Promise.all([...writes]);
  if (writeError) throw writeError;
}

export function closeWebPlaylistSession() {
  session?.close();
}

export function resetWebPlaylistPrivateRoute() {
  if (window.location.hash.startsWith("#/local-collection/")) window.location.hash = "#/";
}
