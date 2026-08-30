import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStore: vi.fn(),
  getUserInfo: vi.fn(),
}));

vi.mock("@/platform", () => ({
  default: {
    clearStore: vi.fn(),
    getStore: mocks.getStore,
    setStore: vi.fn(),
  },
  isWeb: true,
}));
vi.mock("@/service/user-info", () => ({ getUserInfo: mocks.getUserInfo }));

describe("browser Sentry user context", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getStore.mockResolvedValue({});
    mocks.getUserInfo.mockResolvedValue({ code: 0, data: { isLogin: true, mid: 42, uname: "Biu" } });
  });

  it("sets the verified account and clears it on logout", async () => {
    const setUser = vi.fn();
    window.__biuMonitoring = {
      captureException: vi.fn(),
      captureMessage: vi.fn(),
      setUser,
    };

    const { useUser } = await import("@/store/user");
    await useUser.getState().updateUser();
    expect(setUser).toHaveBeenLastCalledWith({ id: "42", username: "Biu" });

    useUser.getState().clear();
    expect(setUser).toHaveBeenLastCalledWith(null);
  });
});
