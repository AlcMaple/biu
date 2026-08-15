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
  const formatSrc = formatUrlProtocol(src)?.replace(BILIBILI_IMAGE_HOST_PATTERN, matched =>
    matched.replace(/^http:/i, "https:"),
  );
  const finalSrc =
    params && formatSrc && formatSrc.includes("/bfs/") && !formatSrc.includes("@")
      ? `${formatSrc}@${params}`
      : formatSrc;
  const isBilibiliImage = Boolean(finalSrc && /^(?:https?:)?\/\/(?:[^/]+\.)?hdslb\.com\//i.test(finalSrc));
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
      width={width}
      height={height}
      src={finalSrc}
      referrerPolicy={referrerPolicy ?? (isBilibiliImage ? "no-referrer" : undefined)}
      onError={event => {
        setFailedSrc(finalSrc);
        onError?.(event);
      }}
      className={twMerge("object-cover", className)}
      {...rest}
    />
  );
};

export default Image;
