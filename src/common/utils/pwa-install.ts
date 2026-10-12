/**
 * PWA 安装：捕获浏览器的 beforeinstallprompt（Chrome/Edge on Android），供设置页的「安装到主屏幕」按钮触发。
 * 事件只会触发一次且通常在页面加载早期，所以必须在应用启动时就开始监听。
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | undefined;
const listeners = new Set<() => void>();
let installed = false;

export const installPwaPromptCapture = () => {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    listeners.forEach(fn => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = undefined;
    listeners.forEach(fn => fn());
  });
};

export const canPromptPwaInstall = () => deferredPrompt !== undefined;

export const subscribePwaInstall = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** 弹出系统的安装确认。返回用户是否接受。 */
export const promptPwaInstall = async (): Promise<boolean> => {
  const prompt = deferredPrompt;
  if (!prompt) return false;
  deferredPrompt = undefined;
  listeners.forEach(fn => fn());
  await prompt.prompt();
  return (await prompt.userChoice).outcome === "accepted";
};

/** 是否已经以独立应用（已安装的 PWA / 主屏幕图标）方式运行 */
export const isRunningStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);
