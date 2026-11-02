import { useUser } from "@/store/user";
import { SANDBOX_VEIL_FLAG, SANDBOX_VEIL_ID, SANDBOX_VEIL_STYLE } from "@shared/sandbox";

// 沙盒换身份要整页刷新（见 SandboxIdentitySwitcher）。刷新中页面会先空白、再露出还没套上主题的白色播放栏、
// 再从「未登录」跳到「已登录」，看起来就是闪烁。所以：
// 1. 刷新前盖一层和背景同色的幕布，并在 sessionStorage 留标记
// 2. 新页面的 HTML 头部同步脚本（SANDBOX_VEIL_BOOT，只在沙盒构建注入）立刻再盖上，赶在任何内容绘制之前；
//    等应用启动后才创建的话，中间会漏出一帧
// 3. 用户信息恢复、页面已渲染出内容后立即淡出。不等 window load：开发构建下它要等所有封面图加载完，
//    幕布会黑好几秒；MAX_MS 兜底，避免某个信号永远不来时一直黑着

const SETTLE_MS = 120;
const MAX_MS = 2000;

export function raiseSandboxVeil() {
  try {
    sessionStorage.setItem(SANDBOX_VEIL_FLAG, "1");
  } catch {
    return;
  }
  const veil = document.createElement("div");
  veil.id = SANDBOX_VEIL_ID;
  veil.style.cssText = SANDBOX_VEIL_STYLE;
  document.documentElement.appendChild(veil);
}

export function resumeSandboxVeil() {
  try {
    sessionStorage.removeItem(SANDBOX_VEIL_FLAG);
  } catch {
    return;
  }
  const veil = document.getElementById(SANDBOX_VEIL_ID);
  if (!veil) return;
  let lifted = false;
  const lift = () => {
    if (lifted) return;
    lifted = true;
    veil.style.opacity = "0";
    setTimeout(() => veil.remove(), 250);
  };
  setTimeout(lift, MAX_MS);
  const poll = () => {
    if (lifted) return;
    const rendered = (document.getElementById("root")?.childElementCount ?? 0) > 0;
    if (rendered && useUser.persist.hasHydrated()) setTimeout(lift, SETTLE_MS);
    else requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}
