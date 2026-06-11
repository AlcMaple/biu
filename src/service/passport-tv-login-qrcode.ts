import SparkMD5 from "spark-md5";

import { passportRequest } from "./request";

/**
 * TV 端扫码登录。
 *
 * Web 端扫码接口（/x/passport-login/web/qrcode/*）2026-06 起被 B 站收紧风控，
 * 第三方生成的二维码在手机扫码确认时报「API校验密匙错误」（同期 downkyi 等
 * 工具同样中招）。TV 端接口走 appkey 签名校验，不受影响，且登录成功后直接
 * 在响应里返回全套 Cookie（SESSDATA/bili_jct/DedeUserID 等）。
 */
const APPKEY = "4409e2ce8ffd12b8";
const APPSEC = "59b43e04ad6965f34319062b478f83dd";

/** APP 签名：参数按 key 排序 urlencode 后拼接 appsec 取 md5，追加为 sign 参数 */
const signParams = (params: Record<string, string>) => {
  const withCommon: Record<string, string> = {
    ...params,
    appkey: APPKEY,
    local_id: "0",
    ts: String(Math.floor(Date.now() / 1000)),
  };
  const query = Object.keys(withCommon)
    .sort()
    .map(key => `${key}=${encodeURIComponent(withCommon[key])}`)
    .join("&");
  return `${query}&sign=${SparkMD5.hash(query + APPSEC)}`;
};

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };

/**
 * 申请二维码(TV端) - 响应类型
 */
export interface TvQrcodeAuthCodeResponse {
  /** 0:成功 -3:API校验密匙错误 -400:请求错误 */
  code: number;
  message: string;
  ttl: number;
  data: {
    /** 二维码内容 url */
    url: string;
    /** 扫码登录秘钥 */
    auth_code: string;
  } | null;
}

/**
 * 扫码登录(TV端) - 响应类型
 */
export interface TvQrcodePollResponse {
  /** 0:成功 86038:二维码已失效 86039:二维码尚未确认 86090:二维码已扫码未确认 */
  code: number;
  message: string;
  data: {
    mid: number;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    cookie_info?: {
      cookies: {
        name: string;
        value: string;
        http_only: number;
        /** 过期时间戳（秒） */
        expires: number;
        secure: number;
      }[];
      domains: string[];
    };
  } | null;
}

/**
 * 二维码登录 - 申请二维码(TV端)
 */
export const postTvQrcodeAuthCode = () => {
  return passportRequest.post<TvQrcodeAuthCodeResponse>("/x/passport-tv-login/qrcode/auth_code", signParams({}), {
    headers: FORM_HEADERS,
  });
};

/**
 * 二维码登录 - 扫码登录状态查询(TV端)
 * @param authCode 申请二维码时返回的扫码登录秘钥
 */
export const postTvQrcodePoll = (authCode: string) => {
  return passportRequest.post<TvQrcodePollResponse>(
    "/x/passport-tv-login/qrcode/poll",
    signParams({ auth_code: authCode }),
    { headers: FORM_HEADERS },
  );
};
