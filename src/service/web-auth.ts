import type { UserInfo } from "./user-info";

import { axiosInstance } from "./request";

const WEB_AUTH_ROOT = "/__biu_auth";

interface WebAuthResponse<T> {
  code: number;
  data: T | null;
  message: string;
}

export interface WebQrCodeData {
  expiresAt: number;
  loginId: string;
  url: string;
}

export interface WebQrPollData {
  user?: UserInfo;
}

export interface WebAuthSessionData {
  isLogin: boolean;
  user?: UserInfo;
}

export interface WebAuthLocationLike {
  hostname: string;
  protocol: string;
}

/** Secure 的 __Host- Cookie 在普通局域网 HTTP 地址不会落盘，禁止开启会产生假成功的扫码流程。 */
export const isWebAuthLocationSupported = (location: WebAuthLocationLike = window.location) => {
  const hostname = location.hostname.toLowerCase();
  return location.protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
};

export const createWebQrCode = () => {
  return axiosInstance.post<WebAuthResponse<WebQrCodeData>>(`${WEB_AUTH_ROOT}/qrcode`, undefined, {
    timeout: 15_000,
  });
};

export const pollWebQrCode = (loginId: string) => {
  return axiosInstance.post<WebAuthResponse<WebQrPollData>>(
    `${WEB_AUTH_ROOT}/qrcode/poll`,
    { loginId },
    { timeout: 15_000 },
  );
};

export const getWebAuthSession = () => {
  return axiosInstance.get<WebAuthResponse<WebAuthSessionData>>(`${WEB_AUTH_ROOT}/session`);
};

export const refreshWebAuthSession = () => {
  return axiosInstance.post<WebAuthResponse<{ refreshed: boolean; user: UserInfo }>>(
    `${WEB_AUTH_ROOT}/session/refresh`,
    undefined,
    { timeout: 45_000 },
  );
};

export const logoutWebAuthSession = () => {
  return axiosInstance.post<WebAuthResponse<{ upstreamLoggedOut: boolean }>>(`${WEB_AUTH_ROOT}/logout`);
};
