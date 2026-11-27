import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("free personal update channel contract", () => {
  it("requires a signed JSON provider and disables unsafe differential downloads", async () => {
    const source = await readFile(path.resolve(process.cwd(), "electron/updater/index.ts"), "utf8");

    expect(source).toContain('provider: "custom"');
    expect(source).toContain("updateProvider: SignedUpdateProvider");
    expect(source).toContain("autoUpdater.disableDifferentialDownload = !(autoUpdater instanceof SelfHostedUpdater)");
    expect(source).toContain("autoUpdater.disableWebInstaller = true");
    expect(source).not.toContain("BIU_SIGNED_AUTO_UPDATE");
  });

  it("publishes a single atomically replaced signed manifest per Windows architecture", async () => {
    const source = await readFile(path.resolve(process.cwd(), "dev_tools/upload-update.js"), "utf8");

    expect(source).toContain("createSignedWindowsManifests");
    expect(source).toContain("atomicPublish(sftp, manifest.fullPath, manifest.filename, config.remoteDir)");
  });
});
