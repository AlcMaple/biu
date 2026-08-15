import type { AxiosResponse } from "axios";

import { beforeEach, describe, expect, it, vi } from "vitest";

const gaiaMocks = vi.hoisted(() => ({
  axios: vi.fn(),
  getCookie: vi.fn(),
  register: vi.fn(),
  setCookie: vi.fn(),
  validate: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("axios", () => ({ default: gaiaMocks.axios }));
vi.mock("@/platform", () => ({
  default: { getCookie: gaiaMocks.getCookie, setCookie: gaiaMocks.setCookie },
  isWeb: true,
}));
vi.mock("@/common/utils/geetest", () => ({ verifyGeetest: gaiaMocks.verify }));
vi.mock("@/service/gaia-vgate", () => ({
  postGaiaVGateRegister: gaiaMocks.register,
  postGaiaVGateValidate: gaiaMocks.validate,
}));

import { geetestInterceptors } from "@/service/request/response-interceptors";

describe("Web Gaia credential boundary", () => {
  beforeEach(() => {
    gaiaMocks.register.mockResolvedValue({ code: 0 });
    gaiaMocks.verify.mockImplementation(async getCaptchaParams => {
      await getCaptchaParams();
      return {
        challenge: "challenge",
        seccode: "seccode",
        token: "token",
        validate: "validate",
      };
    });
    gaiaMocks.validate.mockResolvedValue({ code: 0, data: { grisk_id: "gaia-token" } });
    gaiaMocks.axios.mockResolvedValue({ data: { code: 0 } });
  });

  it("never reads or writes Bilibili Cookie in the Web renderer", async () => {
    const response = {
      config: { headers: {}, params: {}, url: "/x/example" },
      data: { data: { v_voucher: "voucher" } },
    } as AxiosResponse;

    await geetestInterceptors(response);

    expect(gaiaMocks.getCookie).not.toHaveBeenCalled();
    expect(gaiaMocks.setCookie).not.toHaveBeenCalled();
    expect(gaiaMocks.register).toHaveBeenCalledWith({ v_voucher: "voucher" });
    expect(gaiaMocks.validate).toHaveBeenCalledWith({
      challenge: "challenge",
      seccode: "seccode",
      token: "token",
      validate: "validate",
    });
    expect(gaiaMocks.axios).toHaveBeenCalledWith(expect.objectContaining({ params: { gaia_vtoken: "gaia-token" } }));
  });
});
