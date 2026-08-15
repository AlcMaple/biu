import { RiStarFill, RiStarLine } from "@remixicon/react";

import AsyncButton from "@/components/async-button";
import PlatformTooltip from "@/components/platform-tooltip";

export interface FavToggleProps {
  /** 1：已收藏，0：未收藏 */
  isFavorite?: boolean;
  onToggleFavorite?: () => Promise<void>;
}

const FavToggle = ({ isFavorite, onToggleFavorite }: FavToggleProps) => {
  return (
    <PlatformTooltip content={isFavorite ? "取消收藏" : "收藏"}>
      <AsyncButton
        isIconOnly
        size="md"
        variant="flat"
        onPress={onToggleFavorite}
        aria-label={isFavorite ? "取消收藏" : "收藏"}
      >
        {isFavorite ? <RiStarFill size={18} className="text-primary" /> : <RiStarLine size={18} />}
      </AsyncButton>
    </PlatformTooltip>
  );
};

export default FavToggle;
