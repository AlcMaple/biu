import React, { useMemo, useState } from "react";

import { Button, Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { RiArrowDownSLine, RiPriceTag3Line } from "@remixicon/react";
import clx from "classnames";

import ScrollContainer from "@/components/scroll-container";
import { useTagStore } from "@/store/tags";

interface TagPanelProps {
  /** 已选标签 id */
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  /** 行尾显示每个标签已打标的内容数 */
  showCounts?: boolean;
  /** 传入则显示底部「清除筛选」footer（筛选场景） */
  onClear?: () => void;
  className?: string;
  /** 控制列表区高度（默认 max-h-56） */
  listClassName?: string;
}

/**
 * 标签面板：圆环↔色点多选列表（标签的创建/删除在设置页完成）。
 * 既可内嵌使用（收藏弹窗右栏），也可包在 Popover 里作为筛选浮层。
 */
export const TagPanel = ({ selectedIds, onChange, showCounts, onClear, className, listClassName }: TagPanelProps) => {
  const tags = useTagStore(s => s.tags);
  const itemTags = useTagStore(s => s.itemTags);

  const counts = useMemo(() => {
    if (!showCounts) return {} as Record<number, number>;
    const result: Record<number, number> = {};
    for (const ids of Object.values(itemTags)) {
      for (const id of ids) {
        result[id] = (result[id] ?? 0) + 1;
      }
    }
    return result;
  }, [showCounts, itemTags]);

  const toggle = (id: number) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter(i => i !== id) : [...selectedIds, id]);
  };

  return (
    <div className={clx("flex w-full flex-col", className)}>
      <ScrollContainer options={{ scrollbars: { visibility: "hidden" } }} className={listClassName ?? "max-h-56"}>
        <div className="p-1.5">
          {tags.map(tag => {
            const selected = selectedIds.includes(tag.id);
            return (
              <div
                key={tag.id}
                role="button"
                tabIndex={0}
                onClick={() => toggle(tag.id)}
                onKeyDown={e => e.key === "Enter" && toggle(tag.id)}
                className={clx(
                  "hover:bg-default-100 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px]",
                  selected ? "text-foreground" : "text-foreground-500",
                )}
              >
                <span
                  className="border-default-400 size-[13px] flex-none rounded-full border-[1.5px] transition-colors"
                  style={selected ? { backgroundColor: tag.color, borderColor: tag.color } : undefined}
                />
                <span className="min-w-0 truncate">{tag.name}</span>
                {showCounts && (
                  <span className="text-foreground-400 ml-auto text-[10px] tabular-nums">{counts[tag.id] ?? 0}</span>
                )}
              </div>
            );
          })}
        </div>
      </ScrollContainer>

      {Boolean(onClear) && (
        <div className="border-divider text-foreground-400 flex items-center justify-between border-t px-3 py-2 text-[11px]">
          <span>可多选 · 任一命中</span>
          <button
            type="button"
            onClick={onClear}
            className={clx(
              "text-foreground-500 hover:text-foreground text-xs",
              selectedIds.length ? "visible" : "invisible",
            )}
          >
            清除筛选
          </button>
        </div>
      )}
    </div>
  );
};

interface TagFilterPopoverProps {
  activeTagIds: number[];
  onChange: (ids: number[]) => void;
}

/** 工具栏「标签」筛选入口：无标签时整体隐藏，有筛选生效时按钮角上亮主色圆点 */
export const TagFilterPopover = ({ activeTagIds, onChange }: TagFilterPopoverProps) => {
  const tags = useTagStore(s => s.tags);
  const [isOpen, setIsOpen] = useState(false);

  if (!tags.length) return null;

  return (
    <Popover
      placement="bottom-end"
      disableAnimation
      offset={8}
      shouldBlockScroll={false}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
    >
      <PopoverTrigger>
        <Button
          variant="flat"
          radius="md"
          startContent={<RiPriceTag3Line size={16} />}
          endContent={<RiArrowDownSLine size={16} className={clx("transition-transform", { "rotate-180": isOpen })} />}
          className="overflow-visible"
        >
          标签
          {activeTagIds.length > 0 && (
            <span className="bg-primary border-background absolute -top-1 -right-1 size-2.5 rounded-full border-2" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[252px] p-0">
        <TagPanel selectedIds={activeTagIds} onChange={onChange} showCounts onClear={() => onChange([])} />
      </PopoverContent>
    </Popover>
  );
};
