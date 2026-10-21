import got, { RequestError } from "got";

import { ProviderTransportError, type ProviderTransport } from "@shared/lyrics-providers";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// 不重试、不跟随重定向、非 2xx 照样返回：状态码交给渠道层判断限流 / 服务异常
export const providerTransport: ProviderTransport = async request => {
  try {
    const response = await got(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      timeout: { request: 10_000 },
      retry: { limit: 0 },
      followRedirect: false,
      throwHttpErrors: false,
    });
    if (response.rawBody.byteLength > MAX_RESPONSE_BYTES) throw new ProviderTransportError("network");
    const retryAfter = response.headers["retry-after"];
    return {
      status: response.statusCode,
      text: response.body,
      retryAfter: typeof retryAfter === "string" ? retryAfter : undefined,
    };
  } catch (error) {
    if (error instanceof ProviderTransportError) throw error;
    if (error instanceof RequestError && error.code === "ETIMEDOUT") throw new ProviderTransportError("timeout");
    throw new ProviderTransportError("network");
  }
};
