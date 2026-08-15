type CapacitorRuntime = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
};

const getCapacitorRuntime = (): CapacitorRuntime | undefined => {
  if (typeof globalThis === "undefined") return undefined;
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorRuntime }).Capacitor;
};

export const isElectron = typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");

const capacitor = getCapacitorRuntime();
const nativePlatform = !isElectron && capacitor?.isNativePlatform?.() === true ? capacitor.getPlatform?.() : undefined;

export const isAndroid = nativePlatform === "android";
export const isIOS = nativePlatform === "ios";
export const isNativeMobile = isAndroid || isIOS;
export const isWeb = !isElectron && !isNativeMobile;
