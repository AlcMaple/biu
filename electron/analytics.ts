import { app } from "electron";
import isDev from "electron-is-dev";
import log from "electron-log";

import { UMAMI_SEND_URL, UMAMI_WEBSITE_ID } from "../shared/umami";

const REPORT_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const UMAMI_HOSTNAME = "biu-desktop";
const UMAMI_EVENT_NAME = "desktop_active";

type DesktopActivityReason = "startup" | "focus" | "activate" | "second-instance";

let lastReportAt = 0;
let reportInFlight: Promise<void> | undefined;
let umamiCache: string | undefined;

const getUserAgent = () => {
  const platform =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";

  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36`;
};

/**
 * 向 Umami 上报一次桌面应用活跃事件。
 *
 * 只发送版本、系统、架构和触发来源，不发送账号、歌单、搜索词或播放内容。
 * 上报失败不能影响应用启动，也不应在窗口频繁获得焦点时形成请求风暴。
 */
export function reportDesktopActivity(reason: DesktopActivityReason): Promise<void> {
  if (isDev) return Promise.resolve();

  const now = Date.now();
  if (reportInFlight) return reportInFlight;
  if (now - lastReportAt < REPORT_INTERVAL_MS) return Promise.resolve();

  lastReportAt = now;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  reportInFlight = (async () => {
    try {
      const response = await fetch(UMAMI_SEND_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": getUserAgent(),
          "x-umami-hostname": UMAMI_HOSTNAME,
          "x-umami-website-id": UMAMI_WEBSITE_ID,
          ...(umamiCache ? { "x-umami-cache": umamiCache } : {}),
        },
        body: JSON.stringify({
          type: "event",
          payload: {
            website: UMAMI_WEBSITE_ID,
            hostname: UMAMI_HOSTNAME,
            language: "zh-CN",
            title: "Biu Desktop",
            url: "/desktop",
            name: UMAMI_EVENT_NAME,
            data: {
              appVersion: app.getVersion(),
              arch: process.arch,
              platform: process.platform,
              reason,
            },
          },
        }),
      });

      if (!response.ok) throw new Error(`Umami returned HTTP ${response.status}`);

      const data = (await response.json().catch(() => undefined)) as { cache?: unknown } | undefined;
      if (typeof data?.cache === "string" && data.cache) umamiCache = data.cache;
    } catch (error) {
      log.warn("[analytics] Umami 活跃数据上报失败", error);
    } finally {
      clearTimeout(timeout);
      reportInFlight = undefined;
    }
  })();

  return reportInFlight;
}
