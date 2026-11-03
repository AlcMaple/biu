export const isElectron = typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");

export const isWeb = !isElectron;
