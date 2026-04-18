import { apiRequest, biliRequest, memberRequest, passportRequest, searchRequest } from "@/service/request";

import type { PlatformHttp, RequestConfig } from "./types";

const pickInstance = (url: string) => {
  if (url.startsWith("https://api.bilibili.com")) return apiRequest;
  if (url.startsWith("https://passport.bilibili.com")) return passportRequest;
  if (url.startsWith("https://s.search.bilibili.com")) return searchRequest;
  if (url.startsWith("https://member.bilibili.com")) return memberRequest;
  if (url.startsWith("https://www.bilibili.com")) return biliRequest;
  return apiRequest;
};

const http: PlatformHttp = {
  async request<T = unknown>(config: RequestConfig): Promise<T> {
    const instance = pickInstance(config.url);
    const result = await instance.request({
      url: config.url,
      method: config.method ?? "GET",
      params: config.params,
      data: config.data,
      headers: config.headers,
    });
    return result as T;
  },
};

export default http;
