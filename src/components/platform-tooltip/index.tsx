import type { ReactElement } from "react";

import { Tooltip, type TooltipProps } from "@heroui/react";

import { isWeb } from "@/platform";

interface PlatformTooltipProps extends Omit<TooltipProps, "children"> {
  children: ReactElement;
}

/** Web 禁用悬停提示；桌面和 Android 保持原 Tooltip 行为。 */
const PlatformTooltip = ({ children, ...props }: PlatformTooltipProps) => {
  if (isWeb) return children;
  return <Tooltip {...props}>{children}</Tooltip>;
};

export default PlatformTooltip;
