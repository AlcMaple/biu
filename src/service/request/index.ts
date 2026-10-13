import axios, { isAxiosError, type AxiosAdapter, type CreateAxiosDefaults } from "axios";

import { isOfflineDemo } from "@/common/offline-demo";
import { isNativeMobile, isWeb } from "@/platform/detect";
import { resolveBilibiliBaseURL } from "@shared/bilibili-web-proxy";

import { nativeAdapter } from "./native-adapter";
import { requestInterceptors } from "./request-interceptors";
import { geetestInterceptors } from "./response-interceptors";

const offlineDemoAdapter: AxiosAdapter = async config => {
  const { offlineDemoResponse } = await import("@/common/offline-demo-fixtures");
  const data = offlineDemoResponse(config);
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
  ...(isNativeMobile ? { adapter: nativeAdapter } : {}),
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

// axios 原文「timeout of 10000ms exceeded」会被页面直接 toast 出来，用户看不懂也分不清是断网还是服务慢
const describeRequestError = (error: unknown) => {
  if (isAxiosError(error) && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT")) {
    error.message = isWeb
      ? "服务器响应超时：可能正在缓冲音频或网络较慢，稍后再试"
      : "请求超时：B 站响应较慢，请稍后再试";
  }
  return Promise.reject(error);
};

for (const instance of [axiosInstance, biliRequest, apiRequest, passportRequest, searchRequest, memberRequest]) {
  instance.interceptors.response.use(res => res.data, describeRequestError);
}
