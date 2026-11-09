import axios, { type InternalAxiosRequestConfig } from "axios";

import { isWeb } from "@/platform/detect";
import { syncHoldReason } from "@shared/sync-safety";

import { SYNC_SERVER_BASE_URL } from "./config";
import { abandonSyncRequest, beginSyncRequest, finishSyncRequest } from "./safety";
import { isSyncPausedError, SyncPausedError } from "./safety-gate";

export const WEB_SYNC_PROXY_ROOT = "/__biu_sync";

/**
 * 桌面/原生端直连同步服务；Web 只访问同源 BFF。BFF 在服务端使用已验证的 Web
 * 登录会话换取同步 JWT，浏览器不会拿到 B 站 Cookie 或同步 JWT。
 */
export const syncHttp = axios.create({
  baseURL: isWeb ? WEB_SYNC_PROXY_ROOT : SYNC_SERVER_BASE_URL,
  timeout: 10000,
  ...(isWeb ? { withCredentials: true } : {}),
});

// 项目里的全局 axios.d.ts 把 AxiosInstance 的方法类型改成了直接返回 T（不带 .data），
// 靠各实例自己挂一个 res => res.data 的响应拦截器让运行时行为跟类型对上，这里保持一致。
type SafetyConfig = InternalAxiosRequestConfig & { biuSyncTicket?: string };

syncHttp.interceptors.request.use(async config => {
  if (!crypto.randomUUID) throw new SyncPausedError("当前环境不支持同步保护，自动同步未启动");
  const id = crypto.randomUUID();
  await beginSyncRequest(id);
  (config as SafetyConfig).biuSyncTicket = id;
  return config;
});

function failureSignal(status: unknown, data: unknown): number | undefined {
  if (typeof status === "number" && syncHoldReason(status)) return status;
  const code = (data as { code?: unknown })?.code;
  return typeof code === "number" && syncHoldReason(code) ? code : undefined;
}

syncHttp.interceptors.response.use(
  async res => {
    const id = (res.config as SafetyConfig).biuSyncTicket;
    if (id && (res.data === null || typeof res.data !== "object" || Array.isArray(res.data))) {
      await abandonSyncRequest(id);
    }
    if (id) await finishSyncRequest(id, failureSignal(res.status, res.data));
    return res.data;
  },
  async (error: unknown) => {
    if (isSyncPausedError(error)) throw error;
    const response = error as { config?: SafetyConfig; response?: { status?: number; data?: unknown } };
    const id = response.config?.biuSyncTicket;
    if (id) await finishSyncRequest(id, failureSignal(response.response?.status, response.response?.data));
    throw error;
  },
);
