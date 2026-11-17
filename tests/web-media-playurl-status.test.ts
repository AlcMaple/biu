import { describe, expect, test } from "vitest";

import { createMediaApiResponseTransformer } from "../web-server/media-proxy";
import { ProxyRequestError } from "../web-server/proxy-common";

const transformer = createMediaApiResponseTransformer({} as any);
const context = (status: number) => ({ request: {}, response: {}, status }) as any;
const html = Buffer.from("<html>412 Precondition Failed</html>");

describe("取址响应的上游状态码", () => {
  test.each([412, 429])("上游 %i 的非 JSON 正文原样透传，前端才能按状态码认出限流", status => {
    expect(transformer.transform(html, context(status))).toBe(html);
  });

  test("上游 200 却不是 JSON 仍按代理故障报 502", () => {
    expect(() => transformer.transform(html, context(200))).toThrow(ProxyRequestError);
  });
});
