import { logger, type RsbuildPlugin } from "@rsbuild/core";
import { rimrafSync } from "rimraf";

import { buildElectron } from "./electron-build";
import { buildElectronConfig } from "./electron-config-build";
import { startElectronDev } from "./electron-dev";

const isElectronTarget = () => !["android", "ios", "web", "demo"].includes(process.env.BIU_TARGET ?? "");

export const pluginElectron = (): RsbuildPlugin => ({
  name: "plugin-electron",
  setup(api) {
    api.onAfterDevCompile(async ({ isFirstCompile }) => {
      if (isFirstCompile && isElectronTarget()) {
        logger.info("[electron] Bundle the typescript configuration for electron...");
        await buildElectronConfig("development");

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
      await buildElectronConfig();
    });

    api.onAfterBuild(async () => {
      if (!isElectronTarget()) return;

      await buildElectron();
    });
  },
});
