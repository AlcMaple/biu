// 本地沙盒的约定，假 B 站、dev 中间件和页面里的沙盒菜单共用。设计见 docs/ideas/008-本地沙盒测试.md

export type SandboxIdentityId = "guest" | "userA" | "userB" | "admin";

export interface SandboxIdentity {
  id: SandboxIdentityId;
  label: string;
  // 900xxx 是假的，和真实 B 站账号无关。管理员 mid 改了要同步 scripts/sandbox.mjs 的 ADMIN_MID
  mid?: string;
}

export const SANDBOX_IDENTITIES: SandboxIdentity[] = [
  { id: "guest", label: "未登录" },
  { id: "userA", label: "普通用户 A", mid: "900001" },
  { id: "userB", label: "普通用户 B", mid: "900002" },
  { id: "admin", label: "管理员", mid: "900009" },
];

// 页面里的沙盒菜单经 dev 中间件转给假 B 站控制面：确认扫码登录、开关故障
export const SANDBOX_CONTROL_ROOT = "/__biu_sandbox";

export type SandboxFaultKind = "412" | "429" | "500" | "timeout" | "reset";

export interface SandboxFault {
  // 对「域名 + 路径」做子串匹配，例如 api.bilibili.com/x/v3/fav/resource/list
  match: string;
  kind: SandboxFaultKind;
}

export interface SandboxUpstreamState {
  faults: SandboxFault[];
  pcdn: boolean;
  zeroPlay: boolean;
}

// 所有沙盒视频共用一段合成音频；歌词、视频时长、歌词渠道的歌曲时长都按这个长度给，自动匹配才认
export const SANDBOX_AUDIO_SECONDS = 60;
export const SANDBOX_LINE_SECONDS = 5;

// 换身份整页刷新时的防闪烁幕布，用法见 src/common/sandbox-veil.ts；BOOT 是注入 HTML 头部的同步脚本
export const SANDBOX_VEIL_FLAG = "biu-sandbox-veil";
export const SANDBOX_VEIL_ID = "biu-sandbox-veil-el";
export const SANDBOX_VEIL_STYLE =
  "position:fixed;inset:0;z-index:2147483647;background:rgb(23,24,26);transition:opacity 200ms ease;pointer-events:none";
export const SANDBOX_VEIL_BOOT = `try{if(sessionStorage.getItem("${SANDBOX_VEIL_FLAG}")){var v=document.createElement("div");v.id="${SANDBOX_VEIL_ID}";v.style.cssText="${SANDBOX_VEIL_STYLE}";document.documentElement.appendChild(v)}}catch(e){}`;
