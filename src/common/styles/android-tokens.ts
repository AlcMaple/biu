/**
 * Android UI 设计 token，与 docs/android-design/biu-shared.jsx 的 `T` 保持一致。
 *
 * 设计稿用 inline style + 这套 token；Android 端实现时，颜色 / 圆角等具体数值
 * 沿用同一份，避免散落的硬编码 `#1ed760` `#0a0a0a` 在多个文件里漂移。
 *
 * 使用方式：组件内 `style={{ background: T.surface, color: T.fg }}`，结构 / 间距
 * 仍可用 Tailwind utility classes。
 */

export const T = {
  // 背景层级
  bg: "#0a0a0a",
  surface: "#18181b",
  surfaceElev: "#232328",
  surfaceTrans: "rgba(255,255,255,0.06)",
  surfaceTrans2: "rgba(255,255,255,0.10)",
  divider: "rgba(255,255,255,0.08)",

  // 前景文字
  fg: "#fafafa",
  fgMuted: "#a1a1aa",
  fgFaint: "#71717a",

  // 主色（Spotify 绿）
  primary: "#1ed760",
  primaryDim: "rgba(30,215,96,0.18)",
  primaryFg: "#000",

  // 状态色
  amber: "#f5a524",
  amberDim: "rgba(245,165,36,0.16)",
  danger: "#f31260",
  blue: "#338ef7",

  // 圆角
  rSm: 8,
  rMd: 12,
  rLg: 16,
} as const;

export const FONT_STACK =
  '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
