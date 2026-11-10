import { logger, type RsbuildPlugin } from "@rsbuild/core";
import { rimrafSync } from "rimraf";

const isElectronTarget = () => !["web", "demo", "sandbox"].includes(process.env.BIU_TARGET ?? "");

export const pluginElectron = (): RsbuildPlugin => ({
  name: "plugin-electron",
  setup(api) {
    api.onAfterDevCompile(async ({ isFirstCompile }) => {
      if (isFirstCompile && isElectronTarget()) {
        // electron-dev导入时会解析本机二进制，必须在目标判定后加载，避免Web启动触发下载。
        const { buildElectronConfig } = await import("./electron-config-build");
        logger.info("[electron] Bundle the typescript configuration for electron...");
        await buildElectronConfig("development");

        const { startElectronDev } = await import("./electron-dev");
        startElectronDev();
      }
    });

    api.onBeforeBuild(async () => {
      if (!isElectronTarget()) return;

      logger.info("Cleaning dist directory...");
      try {
        rimrafSync("dist");
      } catch (err) {
        logger.error(`Clean dist failed: ${String((err && (err as any).message) || err)}`);
      }

      logger.info("[electron] Bundling Electron TypeScript...");
      const { buildElectronConfig } = await import("./electron-config-build");
      await buildElectronConfig();
    });

    api.onAfterBuild(async () => {
      if (!isElectronTarget()) return;

      const { buildElectron } = await import("./electron-build");
      await buildElectron();
    });
  },
});
