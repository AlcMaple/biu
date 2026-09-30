import { describe, expect, it, vi } from "vitest";

import { replaceRemoteFile } from "../dev_tools/update-sftp.js";

describe("atomic SFTP metadata replacement", () => {
  it("replaces an existing destination through the POSIX extension", async () => {
    const files = new Map([
      ["staged", "new"],
      ["latest", "old"],
    ]);
    const sftp = {
      ext_openssh_rename: vi.fn((from: string, to: string, done: (error?: Error) => void) => {
        files.set(to, files.get(from)!);
        files.delete(from);
        done();
      }),
      rename: vi.fn(),
      unlink: vi.fn(),
    };
    await replaceRemoteFile(sftp, "staged", "latest");
    expect(files.get("latest")).toBe("new");
    expect(files.has("staged")).toBe(false);
    expect(sftp.rename).not.toHaveBeenCalled();
    expect(sftp.unlink).not.toHaveBeenCalled();
  });
  it("fails without deleting metadata when the extension is unsupported", async () => {
    const sftp = {
      ext_openssh_rename: () => {
        throw new Error("unsupported");
      },
      unlink: vi.fn(),
    };
    await expect(replaceRemoteFile(sftp, "staged", "latest")).rejects.toThrow("未删除原有更新清单");
    expect(sftp.unlink).not.toHaveBeenCalled();
  });
  it("propagates a server failure without deleting metadata", async () => {
    const error = new Error("permission denied");
    const sftp = { ext_openssh_rename: (_from: string, _to: string, done: (error: Error) => void) => done(error) };
    await expect(replaceRemoteFile(sftp, "staged", "latest")).rejects.toMatchObject({ cause: error });
  });
});
