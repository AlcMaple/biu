import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadUpdateEnvironment } from "../dev_tools/update-env.js";

const homes: string[] = [];
const home = (content?: string) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "biu-env-test-"));
  homes.push(directory);
  if (content !== undefined) {
    fs.mkdirSync(path.join(directory, ".config", "biu"), { recursive: true });
    fs.writeFileSync(path.join(directory, ".config", "biu", "production.env"), content);
  }
  return directory;
};
afterEach(() => homes.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));

describe("release config auto-loading", () => {
  it("loads the standard user config without shell setup, including quoted paths", () => {
    const environment: Record<string, string> = {};
    loadUpdateEnvironment({
      environment,
      homeDirectory: home(
        'BIU_UPDATE_PUBLISH_HOST=updates.example.com\nBIU_UPDATE_PUBLISH_KEY="C:/Test Fixtures/keys/publisher"',
      ),
    });
    expect(environment.BIU_UPDATE_PUBLISH_HOST).toBe("updates.example.com");
    expect(environment.BIU_UPDATE_PUBLISH_KEY).toBe("C:/Test Fixtures/keys/publisher");
  });
  it("preserves explicitly supplied process variables", () => {
    const environment = { BIU_UPDATE_PUBLISH_HOST: "ci.example.com" };
    loadUpdateEnvironment({ environment, homeDirectory: home("BIU_UPDATE_PUBLISH_HOST=file.example.com") });
    expect(environment.BIU_UPDATE_PUBLISH_HOST).toBe("ci.example.com");
  });
  it("leaves environment-based publishing available when there is no config file", () => {
    expect(loadUpdateEnvironment({ environment: {}, homeDirectory: home() })).toBe(false);
  });
  it("does not load unrelated runtime options or shell variables", () => {
    const environment = {};
    loadUpdateEnvironment({
      environment,
      homeDirectory: home("NODE_OPTIONS=--inspect\nPATH=wrong\nBIU_UPDATE_PUBLISH_USER=publisher"),
    });
    expect(environment).toEqual({ BIU_UPDATE_PUBLISH_USER: "publisher" });
  });
});
