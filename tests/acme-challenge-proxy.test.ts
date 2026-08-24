import type { AddressInfo } from "node:net";

import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ACME_CHALLENGE_PATH_PREFIX, createAcmeChallengeProxyHandler } from "../web-server/acme-challenge-proxy.js";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}

describe("ACME challenge proxy", () => {
  let appOrigin = "";
  let appServer: Server;
  let upstreamOrigin = "";
  let upstreamServer: Server;

  beforeEach(async () => {
    upstreamServer = createServer((request, response) => {
      if (request.url === `${ACME_CHALLENGE_PATH_PREFIX}abc_123-token`) {
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end("abc_123-token.key-authorization");
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    upstreamOrigin = await listen(upstreamServer);

    const handler = createAcmeChallengeProxyHandler({ acmeChallengeOrigin: upstreamOrigin });
    appServer = createServer((request, response) => {
      void handler(request, response).then(handled => {
        if (!handled && !response.writableEnded) {
          response.statusCode = 404;
          response.end();
        }
      });
    });
    appOrigin = await listen(appServer);
  });

  afterEach(async () => {
    await Promise.all([close(appServer), close(upstreamServer)]);
  });

  it("only relays a valid ACME token to a fixed loopback service", async () => {
    const response = await fetch(`${appOrigin}${ACME_CHALLENGE_PATH_PREFIX}abc_123-token`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("abc_123-token.key-authorization");
  });

  it("does not expose the path when the local challenge service is disabled", async () => {
    const handler = createAcmeChallengeProxyHandler();
    const disabled = createServer((request, response) => void handler(request, response));
    const origin = await listen(disabled);

    const response = await fetch(`${origin}${ACME_CHALLENGE_PATH_PREFIX}abc_123-token`);
    expect(response.status).toBe(404);

    await close(disabled);
  });

  it("rejects unsafe origins, request methods, and token paths", async () => {
    expect(() => createAcmeChallengeProxyHandler({ acmeChallengeOrigin: "http://example.com" })).toThrow(/loopback/);

    const method = await fetch(`${appOrigin}${ACME_CHALLENGE_PATH_PREFIX}abc_123-token`, { method: "POST" });
    expect(method.status).toBe(405);

    const traversal = await fetch(`${appOrigin}${ACME_CHALLENGE_PATH_PREFIX}not/a-token`);
    expect(traversal.status).toBe(404);
  });
});
