/** 标签随机配色池（创建时自动分配，允许重复取色） */
const TAG_COLORS = [
  "#ef4444",
  "#f87171",
  "#f97316",
  "#fb923c",
  "#f59e0b",
  "#eab308",
  "#a3e635",
  "#22c55e",
  "#4ade80",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#38bdf8",
  "#3b82f6",
  "#818cf8",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#fb7185",
];

export const randomTagColor = () => TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
