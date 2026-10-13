import { useRef } from "react";

/** 两次点按的最大间隔：与系统默认双击阈值接近，手机上双击也不至于太赶 */
const DOUBLE_PRESS_INTERVAL_MS = 400;

/**
 * 把单次 press 事件转换成「双击才触发」。
 * 手机浏览器的原生 dblclick 不可靠（会被双击缩放吞掉），所以基于 press 时间间隔自己判定，
 * PC 与移动端共用同一套逻辑。
 */
export function useDoublePress(callback?: () => void) {
  const lastPressAt = useRef(0);

  return () => {
    if (!callback) return;
    const now = Date.now();
    if (now - lastPressAt.current <= DOUBLE_PRESS_INTERVAL_MS) {
      lastPressAt.current = 0;
      callback();
      return;
    }
    lastPressAt.current = now;
  };
}
