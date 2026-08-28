import React from "react";

import { Avatar } from "@heroui/react";
import { RiAppsLine, RiSendInsLine } from "@remixicon/react";
import clsx from "classnames";

import { useIsMobileLayout } from "@/common/hooks/use-responsive";
import { isWeb } from "@/platform";

export interface AuthorItem {
  mid: number;
  face: string;
  name: string;
}

interface UserItemProps {
  author: AuthorItem | null;
  isSelected: boolean;
  onSelect: (mid: number | null) => void;
}

const UserItem: React.FC<UserItemProps> = ({ author, isSelected, onSelect }) => {
  const isMobileLayout = useIsMobileLayout();
  const displayName = author?.name || "全部";
  const displayFace = author?.face || "";
  const isAll = author === null;
  return (
    <div
      title={isWeb ? undefined : displayName}
      aria-label={displayName}
      className={clsx(
        "group flex cursor-pointer items-center",
        isMobileLayout
          ? "w-auto min-w-[72px] flex-none flex-col gap-1 px-2 py-1 text-center"
          : "w-full flex-row gap-3 px-2 py-2",
        isSelected ? "text-primary" : "text-default-500",
      )}
      onClick={() => onSelect(author?.mid ?? null)}
      role="button"
      aria-pressed={isSelected}
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(author?.mid ?? null);
        }
      }}
    >
      <Avatar
        src={displayFace}
        name={displayName}
        isBordered={isSelected}
        radius="full"
        color={isSelected && !isAll ? "primary" : "default"}
        className="h-9 w-9 shrink-0 rounded-full transition-transform hover:scale-105"
        classNames={{
          img: "rounded-full",
        }}
        fallback={
          isAll ? (
            <RiAppsLine
              size={18}
              className={clsx({
                "text-primary": isSelected,
              })}
            />
          ) : (
            <RiSendInsLine size={18} />
          )
        }
      />
      <span className={clsx("group-hover:text-primary truncate text-sm", isMobileLayout ? "max-w-20" : "w-full")}>
        {displayName}
      </span>
    </div>
  );
};

export default UserItem;
