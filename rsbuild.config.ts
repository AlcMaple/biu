import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginSvgr } from "@rsbuild/plugin-svgr";
import { sentryWebpackPlugin } from "@sentry/webpack-plugin";
import { execFileSync } from "node:child_process";

import { createBilibiliWebMiddleware } from "./plugins/bilibili-web-proxy";
import postcssScopeDataHover from "./plugins/postcss-scope-data-hover";
import { pluginElectron } from "./plugins/rsbuild-plugin-electron";
import { UMAMI_HOST, UMAMI_WEBSITE_ID } from "./shared/umami";

const isDemoTarget = process.env.BIU_TARGET === "demo";
const isWebTarget = process.env.BIU_TARGET === "web" || isDemoTarget;

function resolveSentryRelease() {
  const explicit = process.env.VITE_SENTRY_RELEASE?.trim() || process.env.SENTRY_RELEASE?.trim();
  if (explicit) return explicit;

  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export default defineConfig(({ command }) => {
  const isWebDevelopment = isWebTarget && command === "dev";
  const isWebProduction = isWebTarget && command === "build";
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();
  const sentryOrg = process.env.SENTRY_ORG?.trim();
  const sentryWebProject = process.env.SENTRY_WEB_PROJECT?.trim() || process.env.SENTRY_PROJECT?.trim();
  const sentryRelease = resolveSentryRelease();
  const uploadSourceMaps = isWebProduction && Boolean(sentryAuthToken && sentryOrg && sentryWebProject);

  if (isWebProduction && sentryAuthToken && (!sentryOrg || !sentryWebProject)) {
    throw new Error("SENTRY_AUTH_TOKEN requires SENTRY_ORG and SENTRY_WEB_PROJECT for a Web build");
  }

  const umamiTrackingTag =
    isWebProduction && !isDemoTarget
      ? {
          tag: "script",
          attrs: {
            async: true,
            src: `${UMAMI_HOST}/script.js`,
            "data-website-id": UMAMI_WEBSITE_ID,
          },
          head: true,
          publicPath: false,
        }
      : undefined;

  return {
    source: {
      define: {
        // 构建版本号：部署时用 BIU_BUILD_ID=<release_stamp> 注入，写进每条回传日志，
        // 这样看日志就能确认手机跑的是哪个版本，不用再靠「有没有硬刷新」猜。
        "process.env.BIU_BUILD_ID": JSON.stringify(process.env.BIU_BUILD_ID || "dev"),
        // Keep this as a string because the browser bundle does not provide a runtime
        // `process` object. Rsbuild replaces the complete expression at build time.
        "process.env.BIU_OFFLINE_DEMO": JSON.stringify(isDemoTarget ? "true" : "false"),
        __BIU_SENTRY_ENABLED__: JSON.stringify(Boolean(isWebProduction && process.env.VITE_SENTRY_DSN?.trim())),
        "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(process.env.VITE_SENTRY_DSN?.trim() || ""),
        "import.meta.env.VITE_SENTRY_ENVIRONMENT": JSON.stringify(process.env.VITE_SENTRY_ENVIRONMENT?.trim() || ""),
        "import.meta.env.VITE_SENTRY_RELEASE": JSON.stringify(sentryRelease || ""),
        "import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE": JSON.stringify(
          process.env.VITE_SENTRY_TRACES_SAMPLE_RATE?.trim() || "",
        ),
      },
    },
    output: {
      distPath: {
        root: isDemoTarget ? "./docs/responsive-prototype/runtime" : "./dist/web",
      },
      // 生产环境相对路径，保证通过 file:// 加载时静态资源能正确引用
      assetPrefix: "./",
      // Web 开发只使用内存文件系统，不能先清掉可部署的生产目录。
      cleanDistPath: !isWebDevelopment,
      ...(isWebProduction
        ? {
            sourceMap: {
              js: uploadSourceMaps ? "hidden-source-map" : false,
              css: false,
            },
          }
        : {}),
    },
    performance: {
      removeMomentLocale: true,
    },
    html: {
      template: "./src/index.html",
      ...(umamiTrackingTag ? { tags: [umamiTrackingTag] } : {}),
    },
    plugins: [
      pluginReact(),
      pluginSvgr({
        svgrOptions: {
          exportType: "named",
          // Enable SVGO to optimize inline SVGs
          svgo: true,
          svgoConfig: {
            plugins: [
              {
                name: "preset-default",
                params: { overrides: { removeViewBox: false } },
              },
            ],
          },
        },
      }),
      pluginElectron(),
    ],
    tools: {
      postcss(_options, { addPlugins }) {
        addPlugins(postcssScopeDataHover, { order: "post" });
      },
      rspack(config) {
        if (!uploadSourceMaps) return;

        config.plugins.push(
          sentryWebpackPlugin({
            org: sentryOrg,
            project: sentryWebProject,
            authToken: sentryAuthToken,
            telemetry: false,
            errorHandler: error => {
              console.warn(`[sentry] source map upload failed: ${error.message}`);
            },
            release: sentryRelease
              ? {
                  name: sentryRelease,
                  inject: true,
                  create: true,
                  finalize: true,
                  setCommits: false,
                }
              : undefined,
            sourcemaps: {
              assets: ["./dist/web/**/*.js", "./dist/web/**/*.map"],
              filesToDeleteAfterUpload: ["./dist/web/**/*.map"],
            },
          }),
        );
      },
    },
    dev: {
      // Electron 需要主/预加载构建产物落盘；Web 开发服务器应只使用内存产物，
      // 否则一次 `pnpm dev:web` 会覆盖或清掉可部署的 dist/web。
      writeToDisk: !isWebDevelopment,
      lazyCompilation: false,
      cliShortcuts: false,
      // 开发环境相对路径，保证通过 file:// 加载时静态资源能正确引用
      assetPrefix: "./",
      ...(isWebTarget && !isDemoTarget
        ? {
            setupMiddlewares: ({ unshift }) => {
              unshift(createBilibiliWebMiddleware());
            },
          }
        : {}),
    },
    server: {
      host: "0.0.0.0",
      port: 5678,
      strictPort: true,
      printUrls: isWebTarget,
      open: false,
      compress: false,
    },
  };
});
