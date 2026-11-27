import { describe, expect, it, vi } from "vitest";

import {
  checkRemoteUpdateVersion,
  putFile,
  replaceRemoteFile,
  withRemotePublishLock,
} from "../dev_tools/update-sftp.js";
import { UPDATE_ENVELOPE_MAX_BYTES } from "../shared/update-signing.js";

it("reports acknowledged bytes, low upload speed and time remaining without logging every chunk", async () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const summary = vi.spyOn(console, "log").mockImplementation(() => {});
  const fastPut = vi.fn((_local, _remote, { step }, done) => {
    step(1024, 1024, 1024 ** 2);
    clock.mockReturnValue(10_000);
    step(256 * 1024, 255 * 1024, 1024 ** 2);
    clock.mockReturnValue(40_000);
    step(1024 ** 2, 768 * 1024, 1024 ** 2);
    done(null);
  });
  try {
    await putFile({ fastPut }, "installer", "temporary", true);
    expect(output.mock.calls.map(([line]) => String(line)).filter(line => line.includes("%"))).toEqual([
      expect.stringContaining("25%  0.3 / 1.0 MiB  均速 25.6 KiB/s  预计剩余 30 秒"),
    ]);
    expect(summary).toHaveBeenCalledWith(expect.stringContaining("已传 1.0 MiB，用时 40.0 秒，均速 25.6 KiB/s"));
  } finally {
    clock.mockRestore();
    output.mockRestore();
    summary.mockRestore();
  }
});

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

describe("self-hosted release preflight", () => {
  const missing = Object.assign(new Error("No such file"), { code: 2 });

  function readServerFiles(
    files: Record<string, string>,
    close: (handle: Buffer, done: (error: Error | null) => void) => void = (_handle, done) => done(null),
  ) {
    return {
      open(filename: string, _flags: string, done: (error: Error | null, handle?: Buffer) => void) {
        if (!(filename in files)) {
          done(missing);
          return;
        }
        done(null, Buffer.from(filename));
      },
      read(
        handle: Buffer,
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
        done: (error: null, bytes: number) => void,
      ) {
        const contents = Buffer.from(files[handle.toString()]);
        done(null, contents.copy(buffer, offset, position, position + length));
      },
      close,
    };
  }

  it("accepts a first release and orders versions numerically", async () => {
    await expect(checkRemoteUpdateVersion(readServerFiles({}), "/updates/", ["win"], "2.8.0")).resolves.toBeUndefined();
    const sftp = readServerFiles({ "/updates/latest.yml": 'version: "2.9.0"\n' });
    await expect(checkRemoteUpdateVersion(sftp, "/updates/", ["win"], "2.10.0")).resolves.toBeUndefined();
  });

  it("protects an existing installer by blocking its version and older versions", async () => {
    const sftp = readServerFiles({ "/updates/latest.yml": "version: 2.8.0\n" });
    for (const version of ["2.7.0", "2.8.0", "2.8.0-beta.1"]) {
      await expect(checkRemoteUpdateVersion(sftp, "/updates/", ["win"], version)).rejects.toThrow(/已使用 2.8.0/);
    }
  });

  it("rejects a damaged signed manifest in either architecture", async () => {
    const sftp = readServerFiles({ "/updates/latest-arm64.json": "{}" });
    await expect(checkRemoteUpdateVersion(sftp, "/updates/", ["win"], "2.8.0")).rejects.toThrow(/更新清单无效/);
  });

  it("waits for the remote handle to close before finishing the preflight", async () => {
    let closed = false;
    const sftp = readServerFiles({ "/updates/latest.yml": "version: 2.7.0\n" }, (_handle, done) => {
      setImmediate(() => {
        closed = true;
        done(null);
      });
    });
    await checkRemoteUpdateVersion(sftp, "/updates/", ["win"], "2.8.0");
    expect(closed).toBe(true);
  });

  it("closes a manifest handle when the byte limit is exceeded", async () => {
    const close = vi.fn((_handle, done) => done(null));
    const sftp = readServerFiles({ "/updates/latest.yml": "x".repeat(UPDATE_ENVELOPE_MAX_BYTES + 1) }, close);
    await expect(checkRemoteUpdateVersion(sftp, "/updates/", ["win"], "2.8.0")).rejects.toThrow(/响应过大/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("blocks another publishing computer and releases the lock after a failed upload", async () => {
    let locked = false;
    const sftp = {
      mkdir: vi.fn((_name, done) => {
        if (locked) {
          done(new Error("already exists"));
          return;
        }
        locked = true;
        done(null);
      }),
      rmdir: vi.fn((_name, done) => {
        locked = false;
        done(null);
      }),
    };
    const upload = vi.fn().mockResolvedValue(undefined);
    await expect(
      withRemotePublishLock(sftp, "/updates/", async () => {
        await expect(withRemotePublishLock(sftp, "/updates/", upload)).rejects.toThrow(/无法锁定/);
        expect(upload).not.toHaveBeenCalled();
        throw new Error("network lost");
      }),
    ).rejects.toThrow("network lost");
    await withRemotePublishLock(sftp, "/updates/", upload);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(sftp.rmdir).toHaveBeenCalledTimes(2);
  });
});
