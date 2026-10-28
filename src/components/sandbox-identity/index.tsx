import type { Key } from "react";

import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownSection, DropdownTrigger } from "@heroui/react";
import { RiFlaskLine } from "@remixicon/react";

import { currentSandboxIdentity } from "@/common/sandbox-fixtures";
import { clearSandboxBrowserData } from "@/platform/web";
import { SANDBOX_IDENTITIES, SANDBOX_IDENTITY_COOKIE, type SandboxIdentityId } from "@shared/sandbox";

const CLEAR_KEY = "clear";

// 只在 `pnpm sandbox` 里出现。换身份后刷新页面：登录信息、歌词、对齐状态都按新身份重新取，
// 比逐个 store 去重置可靠，也和真实「换账号」的体验一致
const SandboxIdentitySwitcher = () => {
  const current = currentSandboxIdentity();

  const onAction = async (key: Key) => {
    if (key === CLEAR_KEY) {
      await clearSandboxBrowserData();
    } else {
      document.cookie = `${SANDBOX_IDENTITY_COOKIE}=${key as SandboxIdentityId}; path=/; max-age=31536000; SameSite=Lax`;
    }
    window.location.reload();
  };

  return (
    <div className="fixed top-3 left-1/2 z-50 -translate-x-1/2">
      <Dropdown placement="bottom">
        <DropdownTrigger>
          <Button size="sm" variant="flat" color="warning" startContent={<RiFlaskLine size={16} />}>
            沙盒 · {current.label}
          </Button>
        </DropdownTrigger>
        <DropdownMenu
          aria-label="切换沙盒身份"
          selectionMode="single"
          selectedKeys={new Set([current.id])}
          onAction={key => void onAction(key)}
        >
          <DropdownSection title="切换身份" showDivider>
            {SANDBOX_IDENTITIES.map(identity => (
              <DropdownItem key={identity.id} description={identity.mid ? `mid ${identity.mid}` : undefined}>
                {identity.label}
              </DropdownItem>
            ))}
          </DropdownSection>
          <DropdownSection>
            <DropdownItem key={CLEAR_KEY} description="设置、歌单、播放列表；对齐服务的数据用 pnpm sandbox --reset">
              清空本页数据
            </DropdownItem>
          </DropdownSection>
        </DropdownMenu>
      </Dropdown>
    </div>
  );
};

export default SandboxIdentitySwitcher;
