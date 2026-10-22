import { createContext } from "react";

// 播放器顶栏里留给对齐状态标签的位置。标签由歌词组件渲染（搜索歌词、上传歌词的弹窗在那边），
// 用 portal 落到这里，避免为了换位置把弹窗状态提升到播放器
export const AlignChipSlotContext = createContext<HTMLElement | null>(null);
