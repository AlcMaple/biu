import type { TagItemTarget } from "@/store/tags";

const encode = (value: string | number) => encodeURIComponent(String(value));

// 稿件、分集、音频和本地文件的数字可能相同，必须分开命名空间。
export const getItemTagKey = (target: TagItemTarget): string => {
  const rid = encode(target.rid);
  if (target.source === "local") return `local:${rid}`;
  if (target.type === 2) {
    const video = target.bvid?.trim() ? `bvid:${encode(target.bvid.trim())}` : `aid:${rid}`;
    return target.cid !== undefined && target.cid !== null
      ? `video:${video}:cid:${encode(target.cid)}`
      : `video:${video}`;
  }
  if (target.type === 12) return `audio:sid:${rid}`;
  return `type:${target.type ?? "unknown"}:${rid}`;
};
