import { useCallback, useEffect, useState } from "react";

import { addToast } from "@heroui/react";

import { getPassportLoginCaptcha } from "@/service/passport-login-captcha";

import { loadGeetestScript, verifyGeetest, type GeetestResult } from "../utils/geetest";

type GetCaptchaParams = () => Promise<{
  code: number;
  data?: {
    geetest: {
      challenge: string;
      gt: string;
    };
    token: string;
    type: string;
  };
  message: string;
}>;

export const useGeetest = (getCaptchaParams: GetCaptchaParams = getPassportLoginCaptcha) => {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadGeetestScript().catch(() => {
      addToast({ title: "加载风控验证码出错", color: "danger" });
    });
  }, []);

  const verify = useCallback(async (): Promise<GeetestResult | null> => {
    setLoading(true);
    try {
      return await verifyGeetest(getCaptchaParams);
    } finally {
      setLoading(false);
    }
  }, [getCaptchaParams]);

  return { verify, loading };
};
