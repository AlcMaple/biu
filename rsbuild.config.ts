import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginSvgr } from "@rsbuild/plugin-svgr";

import postcssScopeDataHover from "./plugins/postcss-scope-data-hover";
import { pluginElectron } from "./plugins/rsbuild-plugin-electron";

export default defineConfig({
  output: {
    distPath: {
      root: "./dist/web",
    },
    // 生产环境相对路径，保证通过 file:// 加载时静态资源能正确引用
    assetPrefix: "./",
    cleanDistPath: true,
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
    writeToDisk: true,
    lazyCompilation: false,
    cliShortcuts: false,
    // 开发环境相对路径，保证通过 file:// 加载时静态资源能正确引用
    assetPrefix: "./",
  },
  server: {
    host: "0.0.0.0",
    port: 5678,
    strictPort: true,
    printUrls: process.env.BIU_TARGET === "web",
    open: false,
    compress: false,
  },
});
