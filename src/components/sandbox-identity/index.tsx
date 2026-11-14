import { useEffect, useState, type Key } from "react";

import {
  addToast,
  Button,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
} from "@heroui/react";
import { RiFlaskLine } from "@remixicon/react";

import { raiseSandboxVeil } from "@/common/sandbox-veil";
import { clearSandboxBrowserData } from "@/platform/web";
import { createWebQrCode, logoutWebAuthSession, pollWebQrCode } from "@/service/web-auth";
import { useUser } from "@/store/user";
import {
  SANDBOX_CONTROL_ROOT,
  SANDBOX_IDENTITIES,
  type SandboxFault,
  type SandboxIdentityId,
  type SandboxUpstreamState,
} from "@shared/sandbox";

const CLEAR_KEY = "clear";
const RESET_FAULTS_KEY = "faults:none";

// 每一项对应一类真实出过的失败，见 AGENTS.md「网络请求」
const FAULT_PRESETS: { key: string; label: string; fault: SandboxFault }[] = [
  { key: "fault:fav-reset", label: "收藏夹接口断开", fault: { match: "/x/v3/fav/", kind: "reset" } },
  { key: "fault:playurl-412", label: "播放地址被风控（412）", fault: { match: "playurl", kind: "412" } },
  { key: "fault:search-429", label: "搜索被限流（429）", fault: { match: "/x/web-interface/wbi/search", kind: "429" } },
  { key: "fault:view-500", label: "视频详情 5xx", fault: { match: "/x/web-interface/view", kind: "500" } },
  { key: "fault:nav-timeout", label: "用户信息超时", fault: { match: "/x/web-interface/nav", kind: "timeout" } },
];

async function control<T>(name: "approve" | "state", body?: unknown): Promise<T> {
  const response = await fetch(`${SANDBOX_CONTROL_ROOT}/${name}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(data.message || `沙盒控制面返回 HTTP ${response.status}`);
  return data;
}

// 走和登录弹窗同一套 BFF 接口：退出 → 生成二维码 → 让假 B 站「扫码确认」→ 轮询拿到会话
async function loginAs(id: SandboxIdentityId) {
  await logoutWebAuthSession();
  if (id === "guest") return;
  const qr = await createWebQrCode();
  if (qr.code !== 0 || !qr.data) throw new Error(qr.message || "二维码生成失败");
  const authCode = new URL(qr.data.url).searchParams.get("auth_code");
  await control("approve", { authCode, account: id });
  const poll = await pollWebQrCode(qr.data.loginId);
  if (poll.code !== 0) throw new Error(poll.message || `扫码登录失败（${poll.code}）`);
}

// 只在 `pnpm sandbox` 里出现。换身份后刷新页面，和真实「换账号」一样所有数据按新会话重新取
const SandboxIdentitySwitcher = () => {
  const mid = useUser(s => s.user?.mid);
  const current = SANDBOX_IDENTITIES.find(i => (i.mid ? Number(i.mid) === mid : !mid)) ?? SANDBOX_IDENTITIES[0];
  const [upstream, setUpstream] = useState<SandboxUpstreamState>();

  useEffect(() => {
    control<SandboxUpstreamState>("state").then(setUpstream, error =>
      addToast({ title: "读取假 B 站状态失败", description: String(error), color: "danger" }),
    );
  }, []);

  const updateUpstream = async (next: Partial<SandboxUpstreamState>) => {
    setUpstream(await control<SandboxUpstreamState>("state", next));
  };

  const onAction = async (key: Key) => {
    const name = String(key);
    try {
      if (name === RESET_FAULTS_KEY) return await updateUpstream({ faults: [], pcdn: false, zeroPlay: false });
      if (name === "toggle:pcdn") return await updateUpstream({ pcdn: !upstream?.pcdn });
      if (name === "toggle:zeroPlay") return await updateUpstream({ zeroPlay: !upstream?.zeroPlay });
      const preset = FAULT_PRESETS.find(p => p.key === name);
      if (preset) {
        const faults = upstream?.faults ?? [];
        const active = faults.some(f => f.match === preset.fault.match);
        return await updateUpstream({
          faults: active ? faults.filter(f => f.match !== preset.fault.match) : [...faults, preset.fault],
        });
      }

      if (name === CLEAR_KEY) await clearSandboxBrowserData();
      else await loginAs(name as SandboxIdentityId);
      raiseSandboxVeil();
      window.location.reload();
    } catch (error) {
      addToast({
        title: "沙盒操作失败",
        description: error instanceof Error ? error.message : String(error),
        color: "danger",
      });
    }
  };

  const activeKeys = new Set<string>([current.id]);
  if (upstream?.pcdn) activeKeys.add("toggle:pcdn");
  if (upstream?.zeroPlay) activeKeys.add("toggle:zeroPlay");
  for (const preset of FAULT_PRESETS) {
    if (upstream?.faults.some(f => f.match === preset.fault.match)) activeKeys.add(preset.key);
  }
  const faultCount = (upstream?.faults.length ?? 0) + (upstream?.pcdn ? 1 : 0) + (upstream?.zeroPlay ? 1 : 0);

  return (
    <div className="fixed top-3 left-1/2 z-50 -translate-x-1/2">
      <Dropdown placement="bottom">
        <DropdownTrigger>
          <Button size="sm" variant="flat" color="warning" startContent={<RiFlaskLine size={16} />}>
            沙盒 · {current.label}
            {faultCount > 0 ? ` · ${faultCount} 个故障` : ""}
          </Button>
        </DropdownTrigger>
        <DropdownMenu
          aria-label="沙盒菜单"
          selectionMode="multiple"
          selectedKeys={activeKeys}
          closeOnSelect
          onAction={key => void onAction(key)}
        >
          <DropdownSection title="切换身份（走真实扫码登录）" showDivider>
            {SANDBOX_IDENTITIES.map(identity => (
              <DropdownItem key={identity.id} description={identity.mid ? `mid ${identity.mid}` : undefined}>
                {identity.label}
              </DropdownItem>
            ))}
          </DropdownSection>
          <DropdownSection title="假 B 站故障（所有窗口生效）" showDivider>
            {[
              ...FAULT_PRESETS.map(preset => <DropdownItem key={preset.key}>{preset.label}</DropdownItem>),
              <DropdownItem key="toggle:pcdn">播放主地址给 PCDN</DropdownItem>,
              <DropdownItem key="toggle:zeroPlay">收藏夹播放量返回 0</DropdownItem>,
              <DropdownItem key={RESET_FAULTS_KEY}>清除所有故障</DropdownItem>,
            ]}
          </DropdownSection>
          <DropdownSection>
            <DropdownItem key={CLEAR_KEY} description="设置、歌单、播放列表；服务端数据用 pnpm sandbox --reset">
              清空本页数据
            </DropdownItem>
          </DropdownSection>
        </DropdownMenu>
      </Dropdown>
    </div>
  );
};

export default SandboxIdentitySwitcher;
