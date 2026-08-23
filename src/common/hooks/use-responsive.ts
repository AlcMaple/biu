import { useSyncExternalStore } from "react";

import { isNativeMobile } from "@/platform/detect";

/** 与 docs/responsive-prototype 的断点保持一致 */
/** ≤ 767px：移动形态（抽屉侧栏 + MobilePlayBar），与 Capacitor 原生端同形 */
const MOBILE_MAX_WIDTH = 767;
/** ≤ 820px：窄平板，歌曲列表再收掉播放量 */
const NARROW_TABLET_MAX_WIDTH = 820;
/** ≤ 1050px：平板壳，72px 图标侧栏 */
const TABLET_MAX_WIDTH = 1050;

export type LayoutMode = "mobile" | "narrow-tablet" | "tablet" | "desktop";

const hasMatchMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

/**
 * 整个应用共用一份断点订阅。
 *
 * 这里刻意不做成「一个 hook 一个 matchMedia」：`useMusicListColumns` 会在每一个歌曲行里调用，
 * 长列表一次渲染就是几十行。按 hook 建 MediaQueryList 的话，既会在每次渲染里分配对象
 * （`getSnapshot` 必须是廉价且引用稳定的），也会挂上成百个监听器。
 * 改成模块级的三个 MediaQueryList + 缓存快照后，无论多少组件订阅，浏览器侧始终只有三个监听器。
 */
const queries = {
  mobile: `(max-width: ${MOBILE_MAX_WIDTH}px)`,
  narrowTablet: `(max-width: ${NARROW_TABLET_MAX_WIDTH}px)`,
  tablet: `(max-width: ${TABLET_MAX_WIDTH}px)`,
};

let mediaQueryLists: { mobile: MediaQueryList; narrowTablet: MediaQueryList; tablet: MediaQueryList } | undefined;

const getMediaQueryLists = () => {
  if (!hasMatchMedia()) return undefined;
  mediaQueryLists ??= {
    mobile: window.matchMedia(queries.mobile),
    narrowTablet: window.matchMedia(queries.narrowTablet),
    tablet: window.matchMedia(queries.tablet),
  };
  return mediaQueryLists;
};

const readLayoutMode = (): LayoutMode => {
  // 原生移动端不看视口：平板尺寸的 Android/iOS 设备同样要走移动形态。
  if (isNativeMobile) return "mobile";

  const mqls = getMediaQueryLists();
  if (!mqls) return "desktop";
  if (mqls.mobile.matches) return "mobile";
  if (mqls.narrowTablet.matches) return "narrow-tablet";
  if (mqls.tablet.matches) return "tablet";
  return "desktop";
};

// useSyncExternalStore 要求 getSnapshot 返回稳定值，所以快照要缓存，只在 change 事件里重算。
let cachedMode: LayoutMode | undefined;

const subscribers = new Set<() => void>();

const handleChange = () => {
  const next = readLayoutMode();
  if (next === cachedMode) return;
  cachedMode = next;
  subscribers.forEach(notify => notify());
};

// 监听只挂一次、之后不再摘。
// 早先的写法是「首个订阅者挂、最后一个订阅者摘并清缓存」，那样存在一个错位窗口：
// 摘监听到重新挂上之间发生的视口变化收不到，缓存又会被后来的 getSnapshot 懒加载成新值，
// 于是「缓存里是新断点、已挂载的组件却没收到通知」——界面停在旧形态。
// 全局只有这三个监听器，常驻的代价可以忽略。
let isListening = false;

const startListening = () => {
  if (isListening || isNativeMobile) return;

  const mqls = getMediaQueryLists();
  if (!mqls) return;

  isListening = true;
  Object.values(mqls).forEach(mql => mql.addEventListener("change", handleChange));
};

const subscribe = (onChange: () => void) => {
  startListening();
  subscribers.add(onChange);

  return () => {
    subscribers.delete(onChange);
  };
};

const getSnapshot = (): LayoutMode => {
  startListening();
  cachedMode ??= readLayoutMode();
  return cachedMode;
};

const getServerSnapshot = (): LayoutMode => "desktop";

export const useLayoutMode = () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

/**
 * 移动形态：原生移动端，或视口 ≤ 767px 的 Web 窗口。
 * 窄 Web 与 Capacitor 走同一套组件形态，不另建路由树。
 */
export const useIsMobileLayout = () => useLayoutMode() === "mobile";

/** 平板形态：768–1050px，仍是桌面骨架，只收窄侧栏与低优先级信息 */
export const useIsTabletLayout = () => {
  const mode = useLayoutMode();
  return mode === "tablet" || mode === "narrow-tablet";
};
