/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- module mocks preserve production hook names */

import { act } from "react";
import { createRoot } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@heroui/react", () => ({
  Button: ({ children, className, isDisabled, isLoading, onPress, type = "button", ...props }: any) => (
    <button {...props} type={type} className={className} disabled={isDisabled || isLoading} onClick={onPress}>
      {children}
    </button>
  ),
  Input: ({
    ref,
    className,
    classNames: _classNames,
    errorMessage: _errorMessage,
    isClearable: _isClearable,
    isInvalid: _isInvalid,
    startContent: _startContent,
    variant: _variant,
    ...props
  }: any) => {
    void [_classNames, _errorMessage, _isClearable, _isInvalid, _startContent, _variant];
    return <input {...props} ref={ref} className={className} />;
  },
  Select: () => null,
  SelectItem: () => null,
  addToast: vi.fn(),
}));
vi.mock("ahooks", () => ({ useRequest: () => ({ data: [] }) }));
vi.mock("@/platform", () => ({ isWeb: true }));
vi.mock("@/common/hooks/use-geetest", () => ({
  useGeetest: () => ({ loading: false, verify: vi.fn() }),
}));
vi.mock("@/service/generic-country-list", () => ({
  getGenericCountryList: vi.fn(),
}));
vi.mock("@/service/passport-login-web-country", () => ({
  getPassportLoginDefaultCountry: vi.fn(),
}));
vi.mock("@/service/passport-login-web-login-sms", () => ({
  getPassportLoginWebLoginSms: vi.fn(),
}));
vi.mock("@/service/passport-login-web-sms-send", () => ({
  passportLoginWebSmsSend: vi.fn(),
}));
vi.mock("@/service/web-auth", () => ({
  createWebSmsCaptcha: vi.fn(),
  loginWithWebSms: vi.fn(),
  sendWebSmsCode: vi.fn(),
}));

import CodeLogin from "@/layout/navbar/login/code-login";

describe("Web SMS code input", () => {
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

  it("keeps a mobile pasted code to one six-digit value", () => {
    const root = createRoot(container);

    act(() => {
      root.render(<CodeLogin onClose={vi.fn()} updateUserData={vi.fn()} />);
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="验证码"]');
    expect(input).not.toBeNull();
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("maxlength", "6");

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "123456123456" },
    });

    act(() => {
      input?.dispatchEvent(paste);
    });

    expect(paste.defaultPrevented).toBe(true);
    expect(input).toHaveValue("123456");

    act(() => root.unmount());
  });

  it("removes the selected country prefix from a pasted phone number", () => {
    const root = createRoot(container);

    act(() => {
      root.render(<CodeLogin onClose={vi.fn()} updateUserData={vi.fn()} />);
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="请输入手机号"]');
    expect(input).not.toBeNull();

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "+86 138 2590 0730" },
    });

    act(() => {
      input?.dispatchEvent(paste);
    });

    expect(paste.defaultPrevented).toBe(true);
    expect(input).toHaveValue("13825900730");

    act(() => root.unmount());
  });
});
