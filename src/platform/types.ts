/**
 * 平台能力接口。Electron 端映射到 window.electron,Android 端用 noop 填齐。
 *
 * 注意:部分方法在移动端无意义(tray、shortcuts、全局 cookie、窗口控制、更新器等),
 * Android 实现里会返回空值/空函数。UI 侧需配合 `isElectron` 做条件渲染。
 */
export type Platform = ElectronAPI;

export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}
