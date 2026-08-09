import moment from "moment";
import momentDurationFormatSetup from "moment-duration-format";

momentDurationFormatSetup(moment);

export function formatDuration(seconds: number) {
  const dur = moment.duration(seconds, "seconds");

  if (seconds >= 3600) {
    // 超过 60 分钟 → hh:mm:ss
    return dur.format("hh:mm:ss", { trim: false });
  } else {
    // 小于 60 秒 → ss
    return dur.format("mm:ss", { trim: false });
  }
}

/** 将秒数或 B 站返回的 mm:ss / hh:mm:ss 字符串统一转换为秒数。 */
export const parseDuration = (value?: number | string): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (!value?.trim()) return undefined;

  const parts = value.split(":").map(Number);
  if (parts.some(part => !Number.isFinite(part) || part < 0)) return undefined;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 ? seconds : undefined;
};

export const formatSecondsToDate = (s?: number) => (s ? moment.unix(s).format("YYYY-MM-DD") : "");

export const formatMillisecond = (s?: number) => (s ? moment(s).format("YYYY-MM-DD") : "");
