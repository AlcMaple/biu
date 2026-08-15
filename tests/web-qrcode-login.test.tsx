import { act } from "react";
import { createRoot } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PollResponse = {
  code: number;
  data: { user: { isLogin: boolean; mid: number } } | null;
  message: string;
};

const qrMocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  cancelPoll: vi.fn(),
  generationReady: undefined as boolean | undefined,
  locationSupported: vi.fn(() => true),
  pollSuccess: undefined as ((response: PollResponse) => Promise<void>) | undefined,
  refreshCode: vi.fn(),
  setCookie: vi.fn(),
  useRequest: vi.fn(),
}));

vi.mock("ahooks", () => ({ useRequest: qrMocks.useRequest }));
vi.mock("@heroui/react", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  Skeleton: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  addToast: qrMocks.addToast,
}));
vi.mock("@remixicon/react", () => ({ RiRefreshLine: () => <span>刷新</span> }));
vi.mock("qrcode.react", () => ({ QRCodeCanvas: ({ value }: { value: string }) => <div>{value}</div> }));
vi.mock("@/platform", () => ({
  default: { setCookie: qrMocks.setCookie },
  isWeb: true,
  log: { warn: vi.fn() },
}));
vi.mock("@/service/passport-tv-login-qrcode", () => ({
  postTvQrcodeAuthCode: vi.fn(),
  postTvQrcodePoll: vi.fn(),
}));
vi.mock("@/service/web-auth", () => ({
  createWebQrCode: vi.fn(),
  isWebAuthLocationSupported: qrMocks.locationSupported,
  pollWebQrCode: vi.fn(),
}));

import QrcodeLogin from "@/layout/navbar/login/qrcode-login";

describe("Web QR login credential boundary", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    qrMocks.locationSupported.mockReturnValue(true);

    let requestIndex = 0;
    qrMocks.useRequest.mockImplementation((_service, options) => {
      requestIndex += 1;
      if (requestIndex === 1) {
        qrMocks.generationReady = options.ready;
        return {
          data: { pollKey: "opaque-login-id", url: "https://qr.example" },
          error: undefined,
          loading: false,
          refreshAsync: qrMocks.refreshCode,
        };
      }

      qrMocks.pollSuccess = options.onSuccess;
      return { cancel: qrMocks.cancelPoll, data: undefined, error: undefined };
    });
  });

  afterEach(() => {
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("accepts the own-site session without writing Bilibili Cookie or refresh_token", async () => {
    const updateUserData = vi.fn().mockResolvedValue(true);
    const root = createRoot(container);
    act(() => {
      root.render(<QrcodeLogin onClose={vi.fn()} updateUserData={updateUserData} />);
    });

    await act(async () => {
      await qrMocks.pollSuccess?.({
        code: 0,
        data: { user: { isLogin: true, mid: 42 } },
        message: "0",
      });
    });

    expect(qrMocks.setCookie).not.toHaveBeenCalled();
    expect(updateUserData).toHaveBeenCalledWith();
    expect(container.textContent).not.toContain("refresh_token");

    act(() => root.unmount());
  });

  it("does not report success or close while the verified user is still anonymous", async () => {
    const updateUserData = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    const root = createRoot(container);
    act(() => {
      root.render(<QrcodeLogin onClose={onClose} updateUserData={updateUserData} />);
    });

    await act(async () => {
      await qrMocks.pollSuccess?.({
        code: 0,
        data: { user: { isLogin: true, mid: 42 } },
        message: "0",
      });
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(qrMocks.addToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "登录成功" }));
    expect(container).toHaveTextContent("登录状态校验失败，请重试");

    act(() => root.unmount());
  });

  it("stops polling and exposes retry for every fatal QR status", async () => {
    const root = createRoot(container);
    act(() => {
      root.render(<QrcodeLogin onClose={vi.fn()} updateUserData={vi.fn()} />);
    });

    await act(async () => {
      await qrMocks.pollSuccess?.({ code: -412, data: null, message: "请求被拦截" });
    });

    expect(qrMocks.cancelPoll).toHaveBeenCalled();
    expect(container).toHaveTextContent("请求被拦截，请重试");

    act(() => root.unmount());
  });

  it("does not generate a QR code on insecure LAN HTTP origins", () => {
    qrMocks.locationSupported.mockReturnValue(false);
    const root = createRoot(container);
    act(() => {
      root.render(<QrcodeLogin onClose={vi.fn()} updateUserData={vi.fn()} />);
    });

    expect(qrMocks.generationReady).toBe(false);
    expect(container).toHaveTextContent("登录需使用 localhost 或 HTTPS");
    expect(container).toHaveTextContent("当前地址无法安全保存登录会话");

    act(() => root.unmount());
  });
});
