/**
 * Android 网络层最小连通性验证。
 *
 * 验证目标:
 *   1. pagelist 接口(无需登录) -> 能拿到 code===0 + data 数组,说明 CORS/Referer 基础通过
 *   2. nav 接口(未登录)       -> 能拿到 code===-101,说明请求真的到了 B 站,只是没带 Cookie
 *
 * 如何在 Android 模拟器里触发:
 *   1. 在应用任意入口(例如 src/app.tsx)临时加 `import "@/platform/http-test";`
 *      —— 挂载到 window 后,打开 Android WebView 调试(chrome://inspect) 进入控制台
 *   2. 执行:
 *        await __httpTest.runAll()
 *      或单独:
 *        await __httpTest.testPagelist()
 *        await __httpTest.testNav()
 *   3. 通过标准:
 *        pagelist: { code: 0, data: [...] }
 *        nav:      { code: -101, message: "账号未登录" }
 *      出现上述响应即视为网络层可用;若抛 CORS/Network error 则说明还没通。
 *
 * 注:验证完后请移除 `import "@/platform/http-test"`,避免生产构建引入。
 */
import { http } from "./index";

interface BiliResponse<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

export async function testPagelist() {
  const resp = await http.request<BiliResponse>({
    url: "https://api.bilibili.com/x/player/pagelist",
    params: { bvid: "BV1xx411c7mD" },
  });
  console.log("[http-test] pagelist =>", resp);
  return resp;
}

export async function testNav() {
  const resp = await http.request<BiliResponse>({
    url: "https://api.bilibili.com/x/web-interface/nav",
  });
  console.log("[http-test] nav =>", resp);
  return resp;
}

export async function runAll() {
  const results = await Promise.allSettled([testPagelist(), testNav()]);
  console.log("[http-test] runAll =>", results);
  return results;
}

// 挂 window 方便 WebView 控制台直接调用
if (typeof window !== "undefined") {
  (window as unknown as { __httpTest: unknown }).__httpTest = { testPagelist, testNav, runAll };
}
