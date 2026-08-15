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
export const isAndroid =
  !isElectron && capacitor?.getPlatform?.() === "android" && capacitor.isNativePlatform?.() === true;

export const isWeb = !isElectron && !isAndroid;
