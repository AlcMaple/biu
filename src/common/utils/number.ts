const formatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact", // 紧凑模式
  compactDisplay: "short", // 短格式 (万/亿)
  maximumFractionDigits: 2, // 保留几位小数
});

export const formatNumber = (num: number | null | undefined) => {
  if (typeof num !== "number") {
    return num;
  }

  return formatter.format(num) as string;
};

/**
 * 解析播放量。B 站新版统计（开启 vt 的新数据）下，部分视频旧的 play 字段为 0，
 * 真实播放量改放在 vt 字段，导致列表里这些视频播放量显示为「-」。取两者中的非零值即可。
 */
export const resolvePlayCount = (play?: number, vt?: number) => play || vt || 0;
