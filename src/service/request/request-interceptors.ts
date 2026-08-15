import { type InternalAxiosRequestConfig } from "axios";
import moment from "moment";

import { refreshCookie } from "@/common/utils/cookie";
import platform from "@/platform";
import { isWeb } from "@/platform/detect";
import { useToken } from "@/store/token";

import { encodeParamsWbi } from "./wbi-sign";

let refreshCookiePromise: Promise<any> | null = null;

const isScalarFormValue = (value: unknown) =>
  value === null || value === undefined || ["string", "number", "boolean", "bigint"].includes(typeof value);

function toUrlSearchParams(entries: Iterable<[string, unknown]>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of entries) params.append(key, String(value));
  return params;
}

export function shouldCheckCookieRefresh(web: boolean, nextCheckRefreshTime: number | undefined, now: number) {
  return !web && (nextCheckRefreshTime || 0) < now;
}

export async function applyCsrfPolicy(
  config: InternalAxiosRequestConfig,
  web = isWeb,
  readCookie: (name: string) => Promise<string | undefined> = name => platform.getCookie(name),
) {
  const mode = config.useCSRF ? "required" : config.useOptionalCSRF ? "optional" : undefined;
  if (!mode) return;

  if (web) {
    // renderer 只声明注入策略；bili_jct 始终由同源 BFF 从服务端 Cookie jar 读取。
    config.headers.set("X-Biu-Csrf", mode === "required" ? "inject" : "inject-if-present");
    return;
  }

  const csrfToken = await readCookie("bili_jct");
  if (!csrfToken) return;
  if (config.method === "post") {
    config.data ??= {};
    config.data.csrf = csrfToken;
  } else {
    config.params ??= {};
    config.params.csrf = csrfToken;
  }
}

export const requestInterceptors = async (config: InternalAxiosRequestConfig) => {
  if (
    !config.skipRefreshCheck &&
    shouldCheckCookieRefresh(isWeb, useToken.getState().nextCheckRefreshTime, moment().unix())
  ) {
    if (!refreshCookiePromise) {
      useToken.setState({ nextCheckRefreshTime: moment().add(30, "seconds").unix() });
      refreshCookiePromise = refreshCookie().finally(() => {
        refreshCookiePromise = null;
      });
    }
    try {
      await refreshCookiePromise;
    } finally {
      useToken.setState({ nextCheckRefreshTime: moment().add(2, "days").unix() });
    }
  }

  await applyCsrfPolicy(config);

  if (config.useWbi) {
    config.params ??= {};
    config.params = await encodeParamsWbi(config.params);
  }

  if (config.useFormData) {
    if (isWeb) {
      if (config.data instanceof URLSearchParams) {
        config.headers.setContentType("application/x-www-form-urlencoded");
        return config;
      }

      if (config.data instanceof FormData) {
        const entries: Array<[string, FormDataEntryValue]> = [];
        config.data.forEach((value, key) => entries.push([key, value]));
        if (entries.every(([, value]) => typeof value === "string")) {
          config.data = toUrlSearchParams(entries);
          config.headers.setContentType("application/x-www-form-urlencoded");
        } else {
          // 让浏览器为 multipart 自动生成 boundary；BFF 按 X-Biu-Csrf 标记在服务端注入 bili_jct。
          config.headers.delete("Content-Type");
        }
        return config;
      }

      const entries = Object.entries((config.data ?? {}) as Record<string, unknown>);
      if (entries.every(([, value]) => isScalarFormValue(value))) {
        config.data = toUrlSearchParams(entries);
        config.headers.setContentType("application/x-www-form-urlencoded");
        return config;
      }
    }

    const formData = new FormData();
    for (const [key, value] of Object.entries((config.data ?? {}) as Record<string, unknown>)) {
      if (value instanceof Blob) formData.append(key, value);
      else formData.append(key, String(value));
    }
    config.data = formData;
    if (isWeb) config.headers.delete("Content-Type");
  }

  return config;
};
