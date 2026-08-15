/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- module mocks preserve production hook names */
import { act } from "react";
import { createRoot } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loginMocks = vi.hoisted(() => ({
  updateCollectedFavorites: vi.fn(),
  updateCreatedFavorites: vi.fn(),
  updateToken: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@heroui/react", () => ({
  Divider: () => <div>分隔线</div>,
  Modal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div>{children}</div> : null,
  ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tab: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      {title}
      {children}
    </div>
  ),
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  addToast: vi.fn(),
}));

vi.mock("@/platform", () => ({ isNativeMobile: false, isWeb: true }));
vi.mock("@/store/favorite", () => ({
  useFavoritesStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      updateCollectedFavorites: loginMocks.updateCollectedFavorites,
      updateCreatedFavorites: loginMocks.updateCreatedFavorites,
    }),
}));
vi.mock("@/store/token", () => ({
  useToken: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ updateToken: loginMocks.updateToken }),
}));
vi.mock("@/store/user", () => {
  const useUser = (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ updateUser: loginMocks.updateUser });
  useUser.getState = () => ({ user: null });
  return { useUser };
});

vi.mock("@/layout/navbar/login/code-login", () => ({ default: () => <div>短信登录内容</div> }));
vi.mock("@/layout/navbar/login/password-login", () => ({ default: () => <div>密码登录内容</div> }));
vi.mock("@/layout/navbar/login/qrcode-login", () => ({ default: () => <div>扫码登录内容</div> }));

import Login from "@/layout/navbar/login";

describe("Web login UI", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("offers only server-side QR login on ordinary Web", () => {
    const root = createRoot(container);
    act(() => {
      root.render(<Login isOpen onOpenChange={vi.fn()} />);
    });

    expect(container).toHaveTextContent("扫码登录内容");
    expect(container).not.toHaveTextContent("短信登录");
    expect(container).not.toHaveTextContent("密码登录");

    act(() => root.unmount());
  });
});
