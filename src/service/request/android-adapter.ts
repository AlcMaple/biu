import type { AxiosAdapter, AxiosResponse } from "axios";

import { http } from "@/platform";

const normalizeParams = (params: unknown): Record<string, string> | undefined => {
  if (!params || typeof params !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
};

const normalizeData = (data: unknown, headers: Record<string, string>) => {
  if (data instanceof FormData) {
    const obj: Record<string, string> = {};
    data.forEach((value, key) => {
      obj[key] = typeof value === "string" ? value : (value as File).name;
    });
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    return obj;
  }
  return data;
};

const normalizeHeaders = (raw: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object") continue;
    out[k] = String(v);
  }
  return out;
};

export const androidAdapter: AxiosAdapter = async config => {
  const baseURL = config.baseURL ?? "";
  const path = config.url ?? "";
  const url = /^https?:\/\//.test(path) ? path : `${baseURL}${path}`;

  const headers = normalizeHeaders(config.headers);
  const params = normalizeParams(config.params);
  const data = normalizeData(config.data, headers);
  const method = (config.method ?? "get").toUpperCase() as "GET" | "POST" | "PUT" | "DELETE";

  const responseData = await http.request<unknown>({
    url,
    method,
    params,
    data,
    headers,
  });

  return {
    data: responseData,
    status: 200,
    statusText: "OK",
    headers: {},
    config,
    request: null,
  } as AxiosResponse;
};
