// 本地沙盒的约定，浏览器端假数据和 dev 中间件两边共用。设计见 docs/ideas/008-本地沙盒测试.md

export type SandboxIdentityId = "guest" | "userA" | "userB" | "admin";

export interface SandboxIdentity {
  id: SandboxIdentityId;
  label: string;
  // 对齐服务按 mid 认人；900xxx 是假的，和真实 B 站账号无关。管理员 mid 改了要同步 scripts/sandbox.mjs 的 ADMIN_MID
  mid?: string;
}

export const SANDBOX_IDENTITIES: SandboxIdentity[] = [
  { id: "guest", label: "未登录" },
  { id: "userA", label: "普通用户 A", mid: "900001" },
  { id: "userB", label: "普通用户 B", mid: "900002" },
  { id: "admin", label: "管理员", mid: "900009" },
];

export const SANDBOX_DEFAULT_IDENTITY: SandboxIdentityId = "userA";

// 身份放 cookie：dev 中间件要据此签 token，页面也要据此返回「当前登录用户」，两边读同一份
export const SANDBOX_IDENTITY_COOKIE = "biu_sandbox_identity";

export function resolveSandboxIdentity(cookieHeader: string | undefined): SandboxIdentity {
  const value = cookieHeader
    ?.split(";")
    .map(part => part.trim().split("="))
    .find(([name]) => name === SANDBOX_IDENTITY_COOKIE)?.[1];
  return (
    SANDBOX_IDENTITIES.find(i => i.id === value) ?? SANDBOX_IDENTITIES.find(i => i.id === SANDBOX_DEFAULT_IDENTITY)!
  );
}

// 所有沙盒视频共用一段合成音频；歌词、视频时长、歌词渠道的歌曲时长都按这个长度给，自动匹配才认
export const SANDBOX_AUDIO_PATH = "/__biu_sandbox/audio.wav";
export const SANDBOX_AUDIO_SECONDS = 60;
export const SANDBOX_LINE_SECONDS = 5;
