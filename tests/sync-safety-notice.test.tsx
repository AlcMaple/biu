import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SyncSafetyView } from "@/service/sync/safety-gate";

const h = vi.hoisted(() => ({
  staticDemo: false,
  view: { abandonedIds: [] } as SyncSafetyView,
  read: vi.fn(),
  resume: vi.fn(),
}));
vi.mock("@/common/offline-demo", () => ({
  get isStaticDemo() {
    return h.staticDemo;
  },
}));
vi.mock("@/service/sync/safety", () => ({
  useSyncSafetyView: vi.fn(() => h.view),
  refreshSyncSafety: h.read,
  resumeSyncSafety: h.resume,
}));
vi.mock("@heroui/react", () => ({
  Button: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
}));
import SyncSafetyNotice from "@/components/sync-safety-notice";
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  h.staticDemo = false;
  h.view = { abandonedIds: [] };
  h.read.mockResolvedValue(h.view);
  h.resume.mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});
const render = async () => {
  await act(async () => root.render(<SyncSafetyNotice />));
};
const click = async () => {
  await act(async () => container.querySelector("button")!.click());
};
it("正常状态没有说明条或恢复按钮", async () => {
  await render();
  expect(container.querySelector("[role=alert]")).toBeNull();
});
it("暂停文案和可见恢复按钮带上用户看到的版本", async () => {
  h.view = { state: { schema: 1, revision: 7, hold: { reason: "rate_limit", signal: 429, at: 1 } }, abandonedIds: [] };
  await render();
  expect(container.textContent).toContain("同步请求过多");
  await click();
  expect(h.resume).toHaveBeenCalledWith(7);
});
it("旧确认被拒绝时显示状态变化，不伪报恢复成功", async () => {
  h.view = {
    state: { schema: 1, revision: 7, hold: { reason: "service_unavailable", signal: 503, at: 1 } },
    abandonedIds: [],
  };
  h.resume.mockResolvedValue(false);
  await render();
  await click();
  expect(container.textContent).toContain("暂停状态已变化，请重新确认");
});
it("首次本机读取失败时只允许检查记录，不执行恢复", async () => {
  h.view = { abandonedIds: [], error: "同步保护记录读写失败，自动同步已暂停" };
  await render();
  expect(container.textContent).toContain("检查本机记录");
  await click();
  expect(h.read).toHaveBeenCalledTimes(2);
  expect(h.resume).not.toHaveBeenCalled();
});

it("静态文档演示不读取同步保护存储", async () => {
  h.staticDemo = true;
  await render();
  expect(h.read).not.toHaveBeenCalled();
  expect(container.textContent).toBe("");
});
