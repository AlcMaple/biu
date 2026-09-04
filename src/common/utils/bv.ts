const XOR_CODE = 23442827791579n;
const MASK_CODE = (1n << 51n) - 1n;
const BASE = 58n;
const ALPHABET = "FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf";

/**
 * bvid 转 avid（2023 版社区逆向算法，见 bilibili-API-collect BV 号转换）。
 * 输入需为合法 bvid（"BV" 开头 12 位）；输入非法时返回结果无意义，调用方自行保证。
 */
export const bv2av = (bvid: string): number => {
  const arr = Array.from(bvid);
  [arr[3], arr[9]] = [arr[9], arr[3]];
  [arr[4], arr[7]] = [arr[7], arr[4]];
  const num = arr.slice(3).reduce((acc, c) => acc * BASE + BigInt(ALPHABET.indexOf(c)), 0n);
  return Number((num & MASK_CODE) ^ XOR_CODE);
};

const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;

export const tryBv2av = (bvid?: string): number | undefined => {
  if (!bvid || !BVID_PATTERN.test(bvid)) return undefined;
  const aid = bv2av(bvid);
  return Number.isSafeInteger(aid) && aid > 0 ? aid : undefined;
};

export const getFavoriteResourceRid = (item: {
  type: "mv" | "audio";
  source?: "local" | "online";
  id?: string;
  aid?: string;
  sid?: number;
  bvid?: string;
}): string | undefined => {
  if (item.source === "local") return item.id;
  if (item.type === "mv") {
    if (item.aid) return String(item.aid);
    const aid = tryBv2av(item.bvid);
    return aid === undefined ? undefined : String(aid);
  }
  return item.sid === undefined ? undefined : String(item.sid);
};
