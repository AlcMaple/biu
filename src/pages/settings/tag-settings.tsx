import React, { useState } from "react";

import { addToast, Button, Chip, Divider, Input } from "@heroui/react";
import { RiAddLine, RiCheckLine, RiPriceTag3Line } from "@remixicon/react";

import { useTagStore } from "@/store/tags";

const TAG_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#6b7280",
];

const TagSettings = () => {
  const tags = useTagStore(s => s.tags);
  const addTag = useTagStore(s => s.addTag);
  const removeTag = useTagStore(s => s.removeTag);

  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[5]);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (tags.some(t => t.name === trimmed)) {
      addToast({ title: "标签已存在", color: "warning" });
      return;
    }
    addTag(trimmed, color);
    setName("");
  };

  return (
    <div className="space-y-4">
      <Divider />
      <h2>标签</h2>
      <div className="text-sm text-zinc-500">创建标签后可在收藏时打标签，并在收藏夹页面按标签筛选</div>

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
        <div className="flex items-center gap-1.5">
          {TAG_COLORS.map(c => (
            <button
              key={c}
              type="button"
              className="relative flex h-5 w-5 items-center justify-center rounded-full transition-transform hover:scale-110"
              style={{ background: c }}
              onClick={() => setColor(c)}
            >
              {color === c && <RiCheckLine size={12} color="white" />}
            </button>
          ))}
        </div>
        <Button isIconOnly size="sm" variant="flat" color="primary" onPress={handleAdd} isDisabled={!name.trim()}>
          <RiAddLine size={18} />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tags.map(tag => (
          <Chip
            key={tag.id}
            onClose={() => removeTag(tag.id)}
            variant="flat"
            style={{ backgroundColor: tag.color + "22", color: tag.color }}
            classNames={{ closeButton: "text-current opacity-60 hover:opacity-100" }}
          >
            {tag.name}
          </Chip>
        ))}
        {tags.length === 0 && <div className="text-sm text-zinc-400">暂无标签</div>}
      </div>
    </div>
  );
};

export default TagSettings;
