import { isNil } from "es-toolkit/predicate";
import SparkMD5 from "spark-md5";

import { getUserInfo } from "@/service/user-info";
import { useUser } from "@/store/user";

import { cacheWbiKeys, extractWbiKeys, getCachedWbiKeys, getStaleWbiKeys } from "./wbi-key-cache";

const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52,
];

const getMixinKey = (orig: string) =>
  mixinKeyEncTab
    .map(n => orig[n])
    .join("")
    .slice(0, 32);

// 匿名用户不把 WBI 密钥放进 user store，因此优先复用页面内缓存，避免每个请求等待 /nav。
async function getWbiKeys() {
  const user = useUser.getState().user;
  if (user) {
    const userKeys = extractWbiKeys(user.wbi_img);
    if (userKeys) {
      cacheWbiKeys(user.wbi_img);
      return userKeys;
    }
  }

  const cached = getCachedWbiKeys();
  if (cached) return cached;

  try {
    const getUserSignRes = await getUserInfo();
    const fresh = cacheWbiKeys(getUserSignRes?.data?.wbi_img);
    if (fresh) return fresh;
  } catch (error) {
    // 导航接口只是密钥发现通道；短暂超时时继续用最近一次成功的密钥，
    // 让搜索/播放请求有机会在弱网恢复时完成，而不是直接在前置步骤失败。
    const stale = getStaleWbiKeys();
    if (stale) return stale;
    throw error;
  }

  return getStaleWbiKeys() ?? { img_key: "", sub_key: "" };
}

export async function encodeParamsWbi(params: { [key: string]: string | number | object }) {
  const { img_key, sub_key } = await getWbiKeys();

  if (!img_key || !sub_key) {
    return params;
  }

  const mixin_key = getMixinKey(img_key + sub_key),
    curr_time = Math.round(Date.now() / 1000),
    chr_filter = /[!'()*]/g;

  Object.assign(params, { wts: curr_time });
  const query = Object.keys(params)
    .filter(key => !isNil(params[key]))
    .sort()
    .map(key => {
      // B 站 WBI 规范要求签名串去掉这些字符。
      const value = params[key].toString().replace(chr_filter, "");
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join("&");

  const wbiSign = SparkMD5.hash(query + mixin_key);

  return {
    ...params,
    w_rid: wbiSign,
  };
}
