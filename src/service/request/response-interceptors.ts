import type { AxiosResponse } from "axios";

import axios from "axios";

import platform, { isWeb } from "@/platform";

export const geetestInterceptors = async (response: AxiosResponse) => {
  if (response?.data?.data?.v_voucher) {
    const { verifyGeetest } = await import("@/common/utils/geetest");
    const { postGaiaVGateRegister, postGaiaVGateValidate } = await import("@/service/gaia-vgate");

    const v_voucher = response.data.data.v_voucher;

    // 1. 调用 register 接口获取极验参数
    const getCaptchaParams = () => postGaiaVGateRegister({ v_voucher });

    // 2. 唤起极验验证
    const result = await verifyGeetest(getCaptchaParams);

    if (result) {
      // 3. 调用 validate 接口获取 grisk_id (gaia_vtoken)
      const validateRes = await postGaiaVGateValidate({
        challenge: result.challenge,
        token: result.token,
        validate: result.validate,
        seccode: result.seccode,
      });

      if (validateRes.code === 0 && validateRes.data?.grisk_id) {
        const gaia_vtoken = validateRes.data.grisk_id;
        const config = response.config;

        // 4. 原 URL 参数加入 gaia_vtoken
        config.params = { ...config.params, gaia_vtoken };

        // Web 的 B 站 Cookie 只能由 BFF 管理；桌面/原生仍保留现有 Cookie 写入。
        if (!isWeb) await platform.setCookie("x-bili-gaia-vtoken", gaia_vtoken);

        return axios(config);
      }
    }
  }
  return response;
};
