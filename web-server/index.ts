import type { AddressInfo } from "node:net";

import path from "node:path";

import { normalizePublicOrigin } from "./proxy-common.js";
import { closeProductionWebServer, createProductionWebServer } from "./server.js";

const DEFAULT_WEB_HOST = "127.0.0.1";
const DEFAULT_WEB_PORT = 5678;

function parsePort(value: string | undefined) {
  if (!value) return DEFAULT_WEB_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("BIU_WEB_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function isLoopbackHost(host: string) {
  return host === "127.0.0.1" || host === "::1" || host.toLowerCase() === "localhost";
}

export interface WebServerEnvironment {
  clientIpHeader?: string;
  host: string;
  port: number;
  publicOrigin?: string;
  staticRoot: string;
}

export function readWebServerEnvironment(environment: NodeJS.ProcessEnv = process.env): WebServerEnvironment {
  const host = environment.BIU_WEB_HOST || DEFAULT_WEB_HOST;
  const publicOrigin = normalizePublicOrigin(environment.BIU_WEB_PUBLIC_ORIGIN);
  if (!publicOrigin && (environment.NODE_ENV === "production" || !isLoopbackHost(host))) {
    throw new Error(
      "BIU_WEB_PUBLIC_ORIGIN is required for production or non-loopback binding (for example https://biu.example)",
    );
  }

  return {
    clientIpHeader: environment.BIU_WEB_CLIENT_IP_HEADER,
    host,
    port: parsePort(environment.BIU_WEB_PORT),
    publicOrigin,
    staticRoot: path.resolve(process.cwd(), "dist/web"),
  };
}

async function main() {
  const config = readWebServerEnvironment();
  const server = await createProductionWebServer(config);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });

  const address = server.address() as AddressInfo;
  const displayHost = address.address.includes(":") ? `[${address.address}]` : address.address;
  const localOrigin = `http://${displayHost}:${address.port}`;
  console.info(`[web] Biu is listening at ${config.publicOrigin ?? localOrigin}`);
  console.info(`[web] Health check: ${config.publicOrigin ?? localOrigin}/__biu_health`);
  console.info("[web] Sessions are stored in this process only; restarting it signs Web users out.");

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void closeProductionWebServer(server).catch(error => {
      console.error("[web] Failed to stop cleanly", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

void main().catch(error => {
  console.error("[web] Failed to start", error);
  process.exitCode = 1;
});
