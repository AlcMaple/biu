import { useState } from "react";

import { Image as HeroImage, type ImageProps } from "@heroui/react";
import { RiFileImageLine } from "@remixicon/react";
import { twMerge } from "tailwind-merge";

import { formatUrlProtocol } from "@/common/utils/url";

interface Props extends ImageProps {
  params?: string;
  emptyPlaceholder?: React.ReactNode;
}

const BILIBILI_IMAGE_HOST_PATTERN = /^http:\/\/(?:[^/]+\.)?hdslb\.com\//i;

const Image = ({
  params,
  width,
  height,
  src,
  className,
  emptyPlaceholder,
  onError,
  referrerPolicy,
  ...rest
}: Props) => {
  const [failedSrc, setFailedSrc] = useState<string | undefined>();
  const [retry, setRetry] = useState<{ src?: string; count: number }>({ count: 0 });
  const formatSrc = formatUrlProtocol(src)?.replace(BILIBILI_IMAGE_HOST_PATTERN, matched =>
    matched.replace(/^http:/i, "https:"),
  );
  const finalSrc =
    params && formatSrc && formatSrc.includes("/bfs/") && !formatSrc.includes("@")
      ? `${formatSrc}@${params}`
      : formatSrc;
  const isBilibiliImage = Boolean(finalSrc && /^(?:https?:)?\/\/(?:[^/]+\.)?hdslb\.com\//i.test(finalSrc));
  const retryCount = retry.src === finalSrc ? retry.count : 0;
  const isError = Boolean(finalSrc && failedSrc === finalSrc);

  if (!src || isError) {
    return (
      <div
        className={twMerge("border-content2 flex h-full items-center justify-center rounded-md border", className)}
        style={{ width, height }}
      >
        {emptyPlaceholder || <RiFileImageLine size="40%" className="text-default-500" />}
      </div>
    );
  }

  return (
    <HeroImage
      // HeroUI 内部的加载状态不随 src 重置：切歌换封面后会停在上一张图的失败/加载中状态，退出重进（重新挂载）才恢复
      key={`${finalSrc}#${retryCount}`}
      width={width}
      height={height}
      src={finalSrc}
      referrerPolicy={referrerPolicy ?? (isBilibiliImage ? "no-referrer" : undefined)}
      onError={event => {
        // 同一地址偶发一次加载失败（并发请求、连接被重置）就永久显示占位，退出重进才恢复；
        // 先原地重试一次，仍失败才记为失败
        if (retryCount < 1) {
          setRetry({ src: finalSrc, count: retryCount + 1 });
          return;
        }
        setFailedSrc(finalSrc);
        onError?.(event);
      }}
      className={twMerge("object-cover", className)}
      {...rest}
    />
  );
};

export default Image;
