import { CapacitorHttp } from "@capacitor/core";

import { createProviderClient } from "@shared/lyrics-provider-guard";
import { ProviderTransportError, type ProviderTransport } from "@shared/lyrics-providers";

import type { Platform } from "./types";

// 手机 App 与 electron/ipc/provider-transport.ts 对等：WebView 里直接 fetch 有 CORS，也改不了 Referer / UA，
// 走 Capacitor 原生 HTTP；取词、签名、解码和 Electron 主进程跑的是同一份 shared 代码
const TIMEOUT_MS = 10_000;

const nativeTransport: ProviderTransport = async request => {
  try {
    const response = await CapacitorHttp.request({
      url: request.url.toString(),
      method: request.method,
      headers: request.headers,
      data: request.body,
      // 要原始文本：AMLL 的大整数 ID 得在 JSON.parse 之前处理，KRC / LRC 也要自己解码
      responseType: "text",
      disableRedirects: true,
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    });
    const retryAfter = Object.entries(response.headers ?? {}).find(
      ([name]) => name.toLowerCase() === "retry-after",
    )?.[1];
    return {
      status: response.status,
      text: typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? ""),
      retryAfter,
    };
  } catch (error) {
    throw new ProviderTransportError(/timed?[\s_-]*out/i.test(String(error)) ? "timeout" : "network");
  }
};

const client = createProviderClient();

export const nativeSearchProviderLyrics: Platform["searchProviderLyrics"] = params =>
  client.search(nativeTransport, params);

export const nativeGetProviderLyrics: Platform["getProviderLyrics"] = params => client.get(nativeTransport, params);
