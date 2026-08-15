import axios, { type CreateAxiosDefaults } from "axios";

import { isNativeMobile, isWeb } from "@/platform/detect";
import { resolveBilibiliBaseURL } from "@shared/bilibili-web-proxy";

import { nativeAdapter } from "./native-adapter";
import { requestInterceptors } from "./request-interceptors";
import { geetestInterceptors } from "./response-interceptors";

const axiosConfig: CreateAxiosDefaults = {
  timeout: 10000,
  withCredentials: true,
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

axiosInstance.interceptors.response.use(res => res.data);
biliRequest.interceptors.response.use(res => res.data);
apiRequest.interceptors.response.use(res => res.data);
passportRequest.interceptors.response.use(res => res.data);
searchRequest.interceptors.response.use(res => res.data);
memberRequest.interceptors.response.use(res => res.data);
