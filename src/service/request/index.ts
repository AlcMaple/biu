import axios, { isAxiosError, type AxiosAdapter, type CreateAxiosDefaults } from "axios";

import { isOfflineDemo } from "@/common/offline-demo";
import { isWeb } from "@/platform/detect";
import { resolveBilibiliBaseURL } from "@shared/bilibili-web-proxy";

import { requestInterceptors } from "./request-interceptors";
import { geetestInterceptors } from "./response-interceptors";

const offlineDemoAdapter: AxiosAdapter = async config => {
  const data = (await import("@/common/offline-demo-fixtures")).offlineDemoResponse(config);
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  };
};

const axiosConfig: CreateAxiosDefaults = {
  timeout: 10000,
  withCredentials: true,
  ...(isOfflineDemo ? { adapter: offlineDemoAdapter } : {}),
};

export const axiosInstance = axios.create(axiosConfig);

export const searchRequest = axios.create({
  ...axiosConfig,
  baseURL: resolveBilibiliBaseURL("search", isWeb),
});

export const biliRequest = axios.create({
  ...axiosConfig,
  baseURL: resolveBilibiliBaseURL("www", isWeb),
});

export const memberRequest = axios.create({
  ...axiosConfig,
  baseURL: resolveBilibiliBaseURL("member", isWeb),
});

export const apiRequest = axios.create({
  ...axiosConfig,
  baseURL: resolveBilibiliBaseURL("api", isWeb),
});

export const passportRequest = axios.create({
  ...axiosConfig,
  baseURL: resolveBilibiliBaseURL("passport", isWeb),
});

apiRequest.interceptors.request.use(requestInterceptors);
passportRequest.interceptors.request.use(requestInterceptors);
searchRequest.interceptors.request.use(requestInterceptors);
memberRequest.interceptors.request.use(requestInterceptors);

apiRequest.interceptors.response.use(geetestInterceptors);

// axios 原文（「timeout of 10000ms exceeded」「Request failed with status code 502」）会被页面直接 toast 出来，
// 用户看不懂也分不清是断网、被限流还是 B 站出错；被限流时还会以为自己断网而反复重试，把限流打得更狠
const describeHttpStatus = (status: number) => {
  if (status === 429) return "请求太频繁，被 B 站暂时限流（429），请过几分钟再试";
  if (status === 412) return "被 B 站风控拦截（412），请过一会儿再试";
  if (status === 502 || status === 504)
    return isWeb ? `服务器暂时连不上 B 站（${status}），请稍后再试` : `B 站暂时没有响应（${status}），请稍后再试`;
  if (status >= 500) return `B 站服务暂时出错（${status}），请稍后再试`;
  return undefined;
};

const describeRequestError = (error: unknown) => {
  if (!isAxiosError(error)) return Promise.reject(error);
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
    error.message = isWeb
      ? "服务器响应超时：可能正在缓冲音频或网络较慢，稍后再试"
      : "请求超时：B 站响应较慢，请稍后再试";
  } else if (error.response) {
    error.message = describeHttpStatus(error.response.status) ?? error.message;
  } else if (error.code === "ERR_NETWORK") {
    error.message = isWeb ? "连不上服务器，请检查网络" : "连不上 B 站，请检查网络或代理设置";
  }
  return Promise.reject(error);
};

for (const instance of [axiosInstance, biliRequest, apiRequest, passportRequest, searchRequest, memberRequest]) {
  instance.interceptors.response.use(res => res.data, describeRequestError);
}
