import { Route, Routes } from "react-router";

import AndroidSplash from "./splash";

/**
 * Android 端路由根。
 *
 * 与 Electron 端 `src/routes.tsx` 的 routes 树独立——Electron 端那套带 Layout
 * (Navbar + SideNav + PlayBar 等) 完全不适合移动端 shell。
 *
 * 当前阶段：仅 Splash 一屏；后续按 docs/Android 适配 TODO.md 顺序逐步加入
 * 登录 / 首页 / 歌单 / 播放器 / 搜索 / 听歌识曲 等子路由。
 */
export default function AndroidApp() {
  return (
    <Routes>
      <Route path="/" element={<AndroidSplash />} />
      {/* 后续屏幕路由从这里继续添加 */}
      <Route path="*" element={<AndroidSplash />} />
    </Routes>
  );
}
