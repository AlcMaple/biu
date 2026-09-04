import { create } from "zustand";
import { persist } from "zustand/middleware";

import { randomTagColor } from "@/common/constants/tag-colors";
import platform from "@/platform";
import { StoreNameMap } from "@shared/store";

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface TagItemTarget {
  rid: string | number;
  type?: number;
  source?: "local" | "online";
  bvid?: string;
  cid?: string | number;
}

export type TagItemRef = TagItemTarget | string | number;

interface State {
  tags: Tag[];
  // 规范化的歌曲身份 -> 标签 id[]
  itemTags: Record<string, number[]>;
}

interface Action {
  /** 创建标签，不传 color 时从色池随机分配，返回新建的标签 */
  addTag: (name: string, color?: string) => Tag;
  removeTag: (id: number) => void;
  getItemTagIds: (target: TagItemRef) => number[];
  setItemTags: (target: TagItemRef, tagIds: number[]) => void;
}

const encodeTagPart = (value: string | number) => encodeURIComponent(String(value));

// 标签归属键：本地文件、在线音频、整稿视频和视频分集使用互不相同的命名空间。
// 视频优先使用 bvid；分集再追加 cid，避免 aid/cid/auid 数值碰撞。
export const getItemTagKey = (target: TagItemTarget): string => {
  const rid = encodeTagPart(target.rid);

  if (target.source === "local") {
    return `local:${rid}`;
  }

  if (target.type === 2) {
    const videoKey = target.bvid?.trim() ? `bvid:${encodeTagPart(target.bvid.trim())}` : `aid:${rid}`;
    return target.cid !== undefined && target.cid !== null
      ? `video:${videoKey}:cid:${encodeTagPart(target.cid)}`
      : `video:${videoKey}`;
  }

  if (target.type === 12) {
    return `audio:sid:${rid}`;
  }

  return `type:${target.type ?? "unknown"}:${rid}`;
};

const resolveTagRef = (target: TagItemRef) => {
  if (typeof target === "object") {
    return { key: getItemTagKey(target), legacyKey: String(target.rid) };
  }
  return { key: String(target), legacyKey: undefined };
};

export const getItemTagIdsFromMap = (itemTags: Record<string, number[]>, target: TagItemRef): number[] => {
  const { key, legacyKey } = resolveTagRef(target);
  return itemTags[key] ?? (legacyKey ? itemTags[legacyKey] : undefined) ?? [];
};

export const useTagStore = create<State & Action>()(
  persist(
    (set, get) => ({
      tags: [],
      itemTags: {},
      addTag: (name, color) => {
        const tag: Tag = { id: Date.now(), name, color: color ?? randomTagColor() };
        set(state => ({ tags: [...state.tags, tag] }));
        return tag;
      },
      removeTag: id =>
        set(state => {
          const itemTags: Record<string, number[]> = {};
          for (const key of Object.keys(state.itemTags)) {
            const filtered = state.itemTags[key].filter(t => t !== id);
            if (filtered.length) {
              itemTags[key] = filtered;
            }
          }
          return {
            tags: state.tags.filter(t => t.id !== id),
            itemTags,
          };
        }),
      getItemTagIds: target => getItemTagIdsFromMap(get().itemTags, target),
      setItemTags: (target, tagIds) =>
        set(state => {
          const itemTags = { ...state.itemTags };
          const { key, legacyKey } = resolveTagRef(target);
          if (tagIds.length) {
            itemTags[key] = [...tagIds];
          } else {
            delete itemTags[key];
          }
          // 显式编辑时把旧版裸 rid 记录收敛到规范键，避免继续污染其他资源。
          if (legacyKey && legacyKey !== key) {
            delete itemTags[legacyKey];
          }
          return { itemTags };
        }),
    }),
    {
      name: "tags",
      storage: {
        getItem: async () => {
          const store = await platform.getStore(StoreNameMap.Tags);
          return store ? { state: store } : null;
        },
        setItem: async (_, value) => {
          if (value.state) {
            await platform.setStore(StoreNameMap.Tags, value.state);
          }
        },
        removeItem: async () => {
          await platform.clearStore(StoreNameMap.Tags);
        },
      },
      partialize: state => ({ tags: state.tags, itemTags: state.itemTags }),
    },
  ),
);
