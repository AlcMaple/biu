import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginSvgr } from "@rsbuild/plugin-svgr";

import { createBilibiliWebMiddleware } from "./plugins/bilibili-web-proxy";
import postcssScopeDataHover from "./plugins/postcss-scope-data-hover";
import { pluginElectron } from "./plugins/rsbuild-plugin-electron";

const isWebTarget = process.env.BIU_TARGET === "web";

export default defineConfig(({ command }) => {
  const isWebDevelopment = isWebTarget && command === "dev";

  return {
    source: {
      define: {
        // 构建版本号：部署时用 BIU_BUILD_ID=<release_stamp> 注入，写进每条回传日志，
        // 这样看日志就能确认手机跑的是哪个版本，不用再靠「有没有硬刷新」猜。
        "process.env.BIU_BUILD_ID": JSON.stringify(process.env.BIU_BUILD_ID || "dev"),
      },
    },
    output: {
      distPath: {
        root: "./dist/web",
      },
      // 生产环境相对路径，保证通过 file:// 加载时静态资源能正确引用
      assetPrefix: "./",
      // Web 开发只使用内存文件系统，不能先清掉可部署的生产目录。
      cleanDistPath: !isWebDevelopment,
    },
    performance: {
      removeMomentLocale: true,
    },
    html: {
      template: "./src/index.html",
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
    },
    dev: {
      // Electron 需要主/预加载构建产物落盘；Web 开发服务器应只使用内存产物，
      // 否则一次 `pnpm dev:web` 会覆盖或清掉可部署的 dist/web。
      writeToDisk: !isWebDevelopment,
      lazyCompilation: false,
      cliShortcuts: false,
      // 开发环境相对路径，保证通过 file:// 加载时静态资源能正确引用
      assetPrefix: "./",
      ...(isWebTarget
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
