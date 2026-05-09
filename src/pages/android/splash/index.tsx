import { FONT_STACK, T } from "@/common/styles/android-tokens";

import { version as APP_VERSION } from "../../../../package.json";

/**
 * 应用层启动闪屏，对应设计稿 docs/android-design/biu-base.jsx 的 ScreenSplash。
 *
 * 功能层（token 检查、路由跳转、显示时长策略）后续单独迭代，本组件**只负责视觉**。
 *
 * 视觉规范：
 * - 全屏纯黑（与 Android 系统冷启动闪屏无缝衔接，避免白屏闪烁）
 * - 中央：主色绿渐变 logo 方块（92×92, r24）+ "Biu" 36/700 + 副标 13/muted
 * - 底部：版本号 + "非官方 · 仅供学习研究"，11/faint
 */
export default function AndroidSplash() {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{
        background: "#000",
        color: T.fg,
        fontFamily: FONT_STACK,
      }}
    >
      {/* 中央 logo + 标题 */}
      <div className="flex flex-col items-center gap-[18px]">
        {/* Logo：绿渐变方块 + TV+播放键 SVG */}
        <div
          className="flex items-center justify-center"
          style={{
            width: 92,
            height: 92,
            borderRadius: 24,
            background: `linear-gradient(135deg, ${T.primary} 0%, #0fa84a 100%)`,
            boxShadow: "0 14px 50px rgba(30,215,96,0.35)",
          }}
        >
          <svg width="56" height="56" viewBox="0 0 24 24" fill="#000">
            <path d="M7.17 2.76 10.41 6h3.17l3.24-3.24a1 1 0 1 1 1.42 1.41L16.41 6 18.5 6A3.5 3.5 0 0 1 22 9.5v8a3.5 3.5 0 0 1-3.5 3.5h-13A3.5 3.5 0 0 1 2 17.5v-8A3.5 3.5 0 0 1 5.5 6l2.08 0L5.76 4.17a1 1 0 1 1 1.41-1.41ZM18.5 8h-13A1.5 1.5 0 0 0 4 9.5v8A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8Z" />
            <path d="M15.18 12.64a1 1 0 0 1 0 1.72l-4.27 2.56a1 1 0 0 1-1.51-.86v-5.12a1 1 0 0 1 1.51-.86l4.27 2.56Z" />
          </svg>
        </div>

        <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: 1 }}>Biu</div>

        {/* marginTop: -10 与设计稿对齐：主标和副标视觉间距更紧凑 */}
        <div style={{ fontSize: 13, color: T.fgMuted, marginTop: -10 }}>基于 Bilibili 的音乐播放器</div>
      </div>

      {/* 底部版本号 */}
      <div
        className="absolute right-0 left-0 text-center"
        style={{
          bottom: 30,
          fontSize: 11,
          color: T.fgFaint,
          letterSpacing: 0.5,
        }}
      >
        v{APP_VERSION} · 非官方 · 仅供学习研究
      </div>
    </div>
  );
}
