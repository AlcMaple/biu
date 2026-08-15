import { Button, Tooltip, type ButtonProps, type TooltipProps } from "@heroui/react";
import { twMerge } from "tailwind-merge";

import { isWeb } from "@/platform";

interface Props extends Omit<ButtonProps, "startContent"> {
  tooltip?: React.ReactNode;
  tooltipProps?: TooltipProps;
}

const IconButton = ({ tooltip, tooltipProps, children, className, title, ...props }: Props) => {
  const ariaLabel =
    props["aria-label"] ?? (typeof tooltip === "string" ? tooltip : typeof title === "string" ? title : undefined);
  const button = (
    <Button
      isIconOnly
      radius="md"
      size="sm"
      variant="light"
      title={isWeb ? undefined : title}
      className={twMerge("hover:text-primary text-inherit", className)}
      {...props}
      aria-label={ariaLabel}
    >
      {children}
    </Button>
  );

  if (tooltip && !isWeb) {
    return (
      <Tooltip closeDelay={0} content={tooltip} {...tooltipProps}>
        {button}
      </Tooltip>
    );
  }

  return button;
};

export default IconButton;
