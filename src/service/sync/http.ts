import axios from "axios";

import { isWeb } from "@/platform/detect";

import { SYNC_SERVER_BASE_URL } from "./config";

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
syncHttp.interceptors.response.use(res => res.data);
