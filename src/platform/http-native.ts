import { CapacitorHttp } from "@capacitor/core";

import type { PlatformHttp, RequestConfig } from "./types";

import { isIOS } from "./detect";

const BASE_HEADERS: Record<string, string> = {
  Referer: "https://www.bilibili.com",
  Origin: "https://www.bilibili.com",
  "User-Agent": isIOS
    ? "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15"
    : "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36",
};

const http: PlatformHttp = {
  async request<T = unknown>(config: RequestConfig): Promise<T> {
    const response = await CapacitorHttp.request({
      url: config.url,
      method: config.method ?? "GET",
      params: config.params,
      data: config.data,
      headers: {
        ...BASE_HEADERS,
        ...(config.headers ?? {}),
      },
    });
    return response.data as T;
  },
};

export default http;
