import { describe, expect, it } from "vitest";

import { loadUpdatePublishConfig, remoteFile, resolveSshAuth } from "../dev_tools/update-deploy-config.js";

describe("update deployment configuration", () => {
  const baseEnvironment = {
    BIU_UPDATE_PUBLIC_ORIGIN: "https://updates.example.com/updates/",
    BIU_UPDATE_PUBLISH_HOST: "updates.example.com",
  };

  it("requires HTTPS and a safe absolute remote directory", () => {
    expect(loadUpdatePublishConfig(baseEnvironment)).toMatchObject({
      publicOrigin: "https://updates.example.com/updates",
      remoteDir: "/updates/",
      user: "biu-update-publisher",
    });
    expect(() =>
      loadUpdatePublishConfig({ ...baseEnvironment, BIU_UPDATE_PUBLIC_ORIGIN: "http://updates.example.com" }),
    ).toThrow(/HTTPS/);
    expect(() => loadUpdatePublishConfig({ ...baseEnvironment, BIU_UPDATE_REMOTE_DIR: "/updates/../other" })).toThrow(
      /绝对 POSIX 路径/,
    );
  });

  it("uses explicit SFTP account and directory overrides", () => {
    expect(
      loadUpdatePublishConfig({
        ...baseEnvironment,
        BIU_UPDATE_PUBLISH_USER: "publisher",
        BIU_UPDATE_REMOTE_DIR: "/custom",
      }),
    ).toMatchObject({ user: "publisher", remoteDir: "/custom/" });
  });

  it("allows only key or SSH-agent authentication and rejects unsafe filenames", () => {
    expect(() => resolveSshAuth({ environment: {} })).toThrow(/不允许密码认证/);
    expect(resolveSshAuth({ environment: { SSH_AUTH_SOCK: "/private/agent.sock" } })).toEqual({
      agent: "/private/agent.sock",
    });
    expect(remoteFile("/updates/", "latest.yml")).toBe("/updates/latest.yml");
    expect(() => remoteFile("/updates/", "../escape.yml")).toThrow(/文件名不合法/);
  });
});
