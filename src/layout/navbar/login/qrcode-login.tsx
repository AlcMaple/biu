import { useState } from "react";

import { Button, addToast, Skeleton } from "@heroui/react";
import { RiRefreshLine } from "@remixicon/react";
import { useRequest } from "ahooks";
import clx from "classnames";
import { QRCodeCanvas } from "qrcode.react";

import platform, { isWeb, log } from "@/platform";
import { postTvQrcodeAuthCode, postTvQrcodePoll } from "@/service/passport-tv-login-qrcode";
import { createWebQrCode, isWebAuthLocationSupported, pollWebQrCode } from "@/service/web-auth";

type QrcodeLoginProps = {
  onClose: () => void;
  updateUserData: (refreshToken?: string) => Promise<boolean>;
};

const QrcodeLogin = ({ onClose, updateUserData }: QrcodeLoginProps) => {
  const webAuthLocationBlocked = isWeb && !isWebAuthLocationSupported();
  const [loginValidationFailed, setLoginValidationFailed] = useState(false);
  const [terminalPollMessage, setTerminalPollMessage] = useState<string>();
  const {
    loading: genLoading,
    data: qrcodeData,
    error: genError,
    refreshAsync: refreshCode,
  } = useRequest(
    async () => {
      if (isWeb) {
        const response = await createWebQrCode();
        if (response.code !== 0 || !response.data) throw new Error(response.message || "二维码生成失败");
        return { pollKey: response.data.loginId, url: response.data.url };
      }

      const data = await postTvQrcodeAuthCode();
      if (data.code !== 0 || !data.data) throw new Error(data.message || "二维码生成失败");
      return { pollKey: data.data.auth_code, url: data.data.url };
    },
    {
      ready: !webAuthLocationBlocked,
      onError: error => {
        log.warn("[login] 二维码生成失败", error);
        addToast({ title: "二维码生成失败，请手动重试", color: "danger" });
      },
    },
  );

  const {
    data: pollData,
    error: pollError,
    cancel: cancelPoll,
  } = useRequest(
    async () => {
      if (!qrcodeData?.pollKey) throw new Error("二维码登录事务不存在");
      return isWeb ? pollWebQrCode(qrcodeData.pollKey) : postTvQrcodePoll(qrcodeData.pollKey);
    },
    {
      ready: !webAuthLocationBlocked && Boolean(qrcodeData?.pollKey),
      refreshDeps: [qrcodeData?.pollKey],
      pollingInterval: 2000,
      pollingWhenHidden: false,
      onSuccess: async pollData => {
        if (pollData?.code === 0 && pollData.data) {
          cancelPoll();
          if (!isWeb) {
            // App 的 TV 端登录不走 set-cookie，Cookie 在响应体里返回，逐个写入原生/桌面会话。
            const appData = pollData.data as Awaited<ReturnType<typeof postTvQrcodePoll>>["data"];
            for (const cookie of appData?.cookie_info?.cookies ?? []) {
              await platform.setCookie(cookie.name, cookie.value, cookie.expires);
            }

            if (!(await updateUserData(appData?.refresh_token))) {
              setLoginValidationFailed(true);
              return;
            }
          } else {
            // Web 响应只设置自家 HttpOnly 会话，B 站 Cookie 与 refresh_token 不进入 renderer。
            if (!(await updateUserData())) {
              setLoginValidationFailed(true);
              return;
            }
          }

          setLoginValidationFailed(false);
          addToast({ title: "登录成功", color: "success" });
          onClose();
          return;
        }

        if (pollData && pollData.code !== 86039 && pollData.code !== 86090) {
          cancelPoll();
          setTerminalPollMessage(pollData.message || "二维码登录失败");
        }
      },
      onError: error => {
        cancelPoll();
        setTerminalPollMessage("状态查询已中断");
        log.warn("[login] 二维码状态查询失败", error);
        addToast({ title: "登录状态查询失败，请刷新二维码", color: "danger" });
      },
    },
  );

  const needsRefresh = Boolean(genError || pollError || terminalPollMessage || loginValidationFailed);
  const isPendingConfirm = !needsRefresh && (pollData?.code === 86090 || pollData?.code === 0);
  const retryMessage = genError
    ? "二维码生成失败"
    : pollError || terminalPollMessage
      ? terminalPollMessage || "状态查询已中断"
      : loginValidationFailed
        ? "登录状态校验失败"
        : "二维码登录失败";

  const retryQrCode = () => {
    setLoginValidationFailed(false);
    setTerminalPollMessage(undefined);
    void refreshCode();
  };

  return (
    <div className="flex flex-col items-center p-6">
      <div className="mb-4 text-lg font-medium">扫码登录</div>
      <div className="border-divider relative flex h-40 w-40 items-center justify-center overflow-hidden rounded-lg border">
        {webAuthLocationBlocked ? (
          <p className="text-danger px-3 text-center text-sm font-medium">登录需使用 localhost 或 HTTPS</p>
        ) : genLoading || !qrcodeData?.url ? (
          <Skeleton className="rounded-lg">
            <div className="bg-default-300 h-[144px] w-[144px] rounded-lg" />
          </Skeleton>
        ) : (
          <QRCodeCanvas value={qrcodeData?.url} size={144} className="rounded-md" />
        )}
        <div
          className={clx(
            "absolute top-0 right-0 h-full w-full flex-col items-center justify-center bg-black/70 transition",
            {
              hidden: !needsRefresh || webAuthLocationBlocked,
              flex: needsRefresh && !webAuthLocationBlocked,
            },
          )}
        >
          <Button
            aria-label="重新生成二维码"
            isLoading={genLoading}
            isIconOnly
            color="primary"
            variant="solid"
            onPress={retryQrCode}
          >
            <RiRefreshLine />
          </Button>
          {needsRefresh && <p className="mt-2 text-center text-sm font-bold text-white">{retryMessage}，请重试</p>}
        </div>
      </div>
      <p
        className={clx("text-default-500 dark:text-default-400 mt-2 text-sm whitespace-nowrap", {
          "text-warning-500 dark:text-warning-400": isPendingConfirm,
        })}
      >
        {webAuthLocationBlocked
          ? "当前地址无法安全保存登录会话"
          : isPendingConfirm
            ? "二维码已扫码未确认"
            : "请使用bilibili手机客户端扫码登录"}
      </p>
    </div>
  );
};

export default QrcodeLogin;
