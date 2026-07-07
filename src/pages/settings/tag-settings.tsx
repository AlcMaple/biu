import React, { useLayoutEffect, useRef, useState } from "react";

import { addToast, Button, Divider, Input } from "@heroui/react";
import { RiArrowDownSLine, RiDeleteBinLine, RiPriceTag3Line } from "@remixicon/react";
import clx from "classnames";

import { useTagStore } from "@/store/tags";

/** 收起状态的标签区最大高度（约两行胶囊），超出出现渐隐与「展开全部」 */
const COLLAPSED_MAX_HEIGHT = 96;

const TagSettings = () => {
  const tags = useTagStore(s => s.tags);
  const addTag = useTagStore(s => s.addTag);
  const removeTag = useTagStore(s => s.removeTag);

  const [name, setName] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const cloudRef = useRef<HTMLDivElement>(null);

  // 胶囊区内容高度超过两行时才显示渐隐与展开控件
  useLayoutEffect(() => {
    const el = cloudRef.current;
    if (!el) return;
    setOverflowing(el.scrollHeight > COLLAPSED_MAX_HEIGHT + 6);
  }, [tags]);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (tags.some(t => t.name === trimmed)) {
      addToast({ title: "标签已存在", color: "warning" });
      return;
    }
    addTag(trimmed);
    setName("");
    // 新标签可能落在收起后不可见的区域，展开保证可见
    setExpanded(true);
  };

  return (
    <div className="space-y-4">
      <Divider />
      <h2>标签</h2>
      <div className="text-sm text-zinc-500">创建标签后可在收藏时打标签，并在收藏夹页面按标签筛选，颜色自动分配</div>

      <div className="flex items-center gap-2">
        <Input
          size="sm"
          placeholder="输入标签名称，按 Enter 添加"
          value={name}
          onValueChange={setName}
          onKeyDown={e => {
            if (e.key === "Enter") handleAdd();
          }}
          className="max-w-xs"
          startContent={<RiPriceTag3Line size={16} className="text-zinc-400" />}
        />
        <Button size="sm" variant="flat" color="primary" onPress={handleAdd} isDisabled={!name.trim()}>
          添加
        </Button>
      </div>

      <div className="text-foreground-500 flex items-center gap-2 text-sm">
        已创建标签
        <span className="text-foreground-400 text-xs tabular-nums">{tags.length}</span>
      </div>

      <div className={clx("relative overflow-hidden", !expanded && "max-h-24")}>
        <div ref={cloudRef} className="flex flex-wrap gap-2.5">
          {tags.map(tag => (
            <span
              key={tag.id}
              className="border-default-200 bg-default-100 group flex h-[34px] items-center gap-2 rounded-full border pr-2 pl-3.5 text-[13px]"
            >
              <span className="size-2 flex-none rounded-full" style={{ background: tag.color }} />
              {tag.name}
              <button
                type="button"
                aria-label={`删除标签 ${tag.name}`}
                onClick={() => removeTag(tag.id)}
                className="text-foreground-400 hover:bg-danger/15 hover:text-danger flex size-[22px] items-center justify-center rounded-full opacity-0 group-hover:opacity-100"
              >
                <RiDeleteBinLine size={13} />
              </button>
            </span>
          ))}
          {tags.length === 0 && <div className="text-sm text-zinc-400">暂无标签 —— 在上方输入名称创建第一个</div>}
        </div>
        {overflowing && !expanded && (
          <div className="to-background pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent" />
        )}
      </div>

      {overflowing && (
        <Button
          size="sm"
          variant="flat"
          radius="full"
          onPress={() => setExpanded(v => !v)}
          endContent={<RiArrowDownSLine size={14} className={clx({ "rotate-180": expanded })} />}
        >
          {expanded ? "收起" : `展开全部 ${tags.length} 个`}
        </Button>
      )}
    </div>
  );
};

export default TagSettings;
