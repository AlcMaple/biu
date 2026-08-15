import type { RequestHandler } from "@rsbuild/core";

import { createWebApplicationHandler, type WebApplicationHandlerOptions } from "../web-server/application";

export function createBilibiliWebMiddleware(options: WebApplicationHandlerOptions = {}): RequestHandler {
  const handler = createWebApplicationHandler(options);

  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}
