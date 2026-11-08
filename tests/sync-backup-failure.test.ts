import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), warn: vi.fn() }));
vi.mock("@/platform", () => ({
  default: { getStore: storage.get, setStore: storage.set },
  log: { warn: storage.warn },
}));

beforeEach(() => {
  vi.resetModules();
  storage.get.mockResolvedValue({});
  storage.set.mockResolvedValue(undefined);
});

describe("同步前备份失败", () => {
  it("写入失败传播给推送调用方，不把日志当作成功", async () => {
    const { pushLocalBackup } = await import("@/service/sync/backup");
    storage.set.mockRejectedValueOnce(new Error("disk full"));
    await expect(pushLocalBackup("12345", "fav-items", {})).rejects.toThrow("disk full");
  });

  it("读取失败不覆盖旧备份，并允许后续独立操作继续排队", async () => {
    const { pushLocalBackup } = await import("@/service/sync/backup");
    storage.get.mockRejectedValueOnce(new Error("read failed"));
    await expect(pushLocalBackup("12345", "fav-items", {})).rejects.toThrow("read failed");
    expect(storage.set).not.toHaveBeenCalled();
    await expect(pushLocalBackup("12345", "fav-items", {})).resolves.toBeUndefined();
    expect(storage.set).toHaveBeenCalledTimes(1);
  });
});
