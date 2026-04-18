import electronLog from "electron-log/renderer";

import type { Logger, Platform } from "./types";

const platform: Platform = window.electron;

export const log: Logger = {
  error: (...args) => electronLog.error(...args),
  warn: (...args) => electronLog.warn(...args),
  info: (...args) => electronLog.info(...args),
  debug: (...args) => electronLog.debug(...args),
};

export default platform;
