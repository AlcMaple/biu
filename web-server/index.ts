import type { AddressInfo } from "node:net";

import path from "node:path";

import { DEFAULT_CLIENT_LOG_MAX_TOTAL_BYTES, DEFAULT_CLIENT_LOG_RETENTION_DAYS } from "./client-log-store.js";
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

/** 正整数环境变量：留空用默认值，写了就必须合法，避免把「0」这种误配当成静默禁用 */
function parsePositiveInteger(value: string | undefined, fallback: number, name: string) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function isLoopbackHost(host: string) {
  return host === "127.0.0.1" || host === "::1" || host.toLowerCase() === "localhost";
}

export interface WebServerEnvironment {
  clientIpHeader?: string;
  clientLogDir?: string;
  clientLogMaxTotalBytes: number;
  clientLogRetentionDays: number;
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

  // 未配置目录 = 不接收网页端日志回传。生产建议显式指定一个独立目录，便于单独做磁盘配额
  const clientLogDir = environment.BIU_WEB_CLIENT_LOG_DIR
    ? path.resolve(process.cwd(), environment.BIU_WEB_CLIENT_LOG_DIR)
    : undefined;

  return {
    clientIpHeader: environment.BIU_WEB_CLIENT_IP_HEADER,
    clientLogDir,
    clientLogMaxTotalBytes:
      parsePositiveInteger(
        environment.BIU_WEB_CLIENT_LOG_MAX_MB,
        DEFAULT_CLIENT_LOG_MAX_TOTAL_BYTES / (1024 * 1024),
        "BIU_WEB_CLIENT_LOG_MAX_MB",
      ) *
      1024 *
      1024,
    clientLogRetentionDays: parsePositiveInteger(
      environment.BIU_WEB_CLIENT_LOG_RETENTION_DAYS,
      DEFAULT_CLIENT_LOG_RETENTION_DAYS,
      "BIU_WEB_CLIENT_LOG_RETENTION_DAYS",
    ),
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
  console.info(
    config.clientLogDir
      ? `[web] Client logs: ${config.clientLogDir} (kept ${config.clientLogRetentionDays} days, max ${Math.round(config.clientLogMaxTotalBytes / (1024 * 1024))} MB)`
      : "[web] Client logs are disabled (set BIU_WEB_CLIENT_LOG_DIR to collect browser-side logs)",
  );

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
