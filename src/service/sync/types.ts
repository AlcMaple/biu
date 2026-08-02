/**
 * 和 biu-sync-server（见仓库根 `biu-sync-server/src/lib/merge.ts`）保持同构的类型，
 * 两边是独立部署的项目，没有共享包，这里手动保持一致。
 */

export type SyncStoreName = "favorites" | "fav-items" | "tags";

export interface UpsertOp {
  type: "upsert";
  id: string;
  payload: unknown;
  updatedAt: number;
}

export interface RemoveOp {
  type: "remove";
  id: string;
  updatedAt: number;
}

export type SyncOp = UpsertOp | RemoveOp;

export interface LiveEntry {
  __deleted?: false;
  updatedAt: number;
  payload: unknown;
}

export interface TombstoneEntry {
  __deleted: true;
  updatedAt: number;
}

export type StoreEntry = LiveEntry | TombstoneEntry;

/** id -> entry 的扁平快照，和服务端 Envelope.data 结构一致（可能含墓碑） */
export type FlatSnapshot = Record<string, StoreEntry>;

/** 本地 encode* 产出的快照：永远是活条目，不会有墓碑（本地状态里没有"已删除的条目"这个概念） */
export type LiveSnapshot = Record<string, LiveEntry>;

export interface Envelope {
  version: number;
  updatedAt: number;
  data: FlatSnapshot;
}
