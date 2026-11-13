import type { RequestHandler } from "@rsbuild/core";

import { createWebApplicationHandler, type WebApplicationHandlerOptions } from "../web-server/application";
import { resolveMediaSafetyFile } from "../web-server/media-safety-runtime";

export function createBilibiliWebMiddleware(options: WebApplicationHandlerOptions = {}): RequestHandler {
  const handler = createWebApplicationHandler({
    ...options,
    mediaSafetyFile: options.mediaSafetyFile ?? resolveMediaSafetyFile("development"),
  });

  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}
