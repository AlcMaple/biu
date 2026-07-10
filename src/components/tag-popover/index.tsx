import React, { useMemo, useRef, useState } from "react";

import { Button, Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { RiArrowDownSLine, RiPriceTag3Line } from "@remixicon/react";
import clx from "classnames";

import ScrollContainer from "@/components/scroll-container";
import { type Tag, useTagStore } from "@/store/tags";

interface TagPanelProps {
  /** 已选标签 id */
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  /** 覆盖展示的标签列表（默认取全局标签）；筛选场景传入「当前歌单内出现过的标签」 */
  tags?: Tag[];
  /** 传入则显示底部 footer（筛选场景：未选时提示可多选，已选时给「清除筛选」） */
  onClear?: () => void;
  className?: string;
  /** 控制列表区高度（默认 max-h-56） */
  listClassName?: string;
}

/**
 * 标签面板：圆环↔色点多选列表（标签的创建/删除在设置页完成）。
 * 既可内嵌使用（收藏弹窗右栏），也可包在 Popover 里作为筛选浮层。
 */
export const TagPanel = ({
  selectedIds,
  onChange,
  tags: tagsProp,
  onClear,
  className,
  listClassName,
}: TagPanelProps) => {
  const storeTags = useTagStore(s => s.tags);
  const tags = tagsProp ?? storeTags;

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
              </div>
            );
          })}
        </div>
      </ScrollContainer>

      {Boolean(onClear) && (
        <div className="border-divider border-t p-1.5">
          {selectedIds.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="hover:bg-default-100 text-foreground-500 hover:text-foreground w-full rounded-lg px-2 py-1.5 text-center text-[13px] transition-colors"
            >
              清除筛选
            </button>
          ) : (
            <div className="text-foreground-400 py-1 text-center text-[11px]">可多选 · 任一命中</div>
          )}
        </div>
      )}
    </div>
  );
};

interface TagFilterPopoverProps {
  activeTagIds: number[];
  /** 当前歌单内实际出现过的标签 id —— 筛选只针对歌单内部，不展示全局无关标签 */
  availableTagIds: number[];
  onChange: (ids: number[]) => void;
}

/**
 * 工具栏「标签」筛选入口：只展示当前歌单里用到的标签，浮层宽度对齐按钮本身。
 * 歌单内无任何标签时整体隐藏，有筛选生效时按钮角上亮主色圆点。
 */
export const TagFilterPopover = ({ activeTagIds, availableTagIds, onChange }: TagFilterPopoverProps) => {
  const tags = useTagStore(s => s.tags);
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [triggerWidth, setTriggerWidth] = useState<number>();

  // 展示的标签 = 歌单内出现过的 ∪ 当前已选（已选的即便被移出歌单也要能取消，避免筛完清不掉）
  const visibleTags = useMemo(() => {
    const allowed = new Set([...availableTagIds, ...activeTagIds]);
    return tags.filter(t => allowed.has(t.id));
  }, [tags, availableTagIds, activeTagIds]);

  if (!visibleTags.length) return null;

  const handleOpenChange = (open: boolean) => {
    // 展开前量一次触发按钮宽度，让浮层与按钮同宽
    if (open && triggerRef.current) setTriggerWidth(triggerRef.current.offsetWidth);
    setIsOpen(open);
  };

  return (
    <Popover
      placement="bottom-end"
      disableAnimation
      offset={8}
      shouldBlockScroll={false}
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger>
        <Button
          ref={triggerRef}
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
      <PopoverContent className="p-0" style={triggerWidth ? { width: triggerWidth } : undefined}>
        <TagPanel selectedIds={activeTagIds} onChange={onChange} tags={visibleTags} onClear={() => onChange([])} />
      </PopoverContent>
    </Popover>
  );
};
