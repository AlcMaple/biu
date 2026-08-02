import axios from "axios";

import { SYNC_SERVER_BASE_URL } from "./config";

/**
 * 打 biu-sync-server 自己的接口，不是 B 站——不受"渲染端不能直连 B 站"那条限制
 * （服务端 CORS 是放开的，不需要走 Electron 主进程转发）。
 */
export const syncHttp = axios.create({
  baseURL: SYNC_SERVER_BASE_URL,
  timeout: 10000,
});

// 项目里的全局 axios.d.ts 把 AxiosInstance 的方法类型改成了直接返回 T（不带 .data），
// 靠各实例自己挂一个 res => res.data 的响应拦截器让运行时行为跟类型对上，这里保持一致。
syncHttp.interceptors.response.use(res => res.data);
