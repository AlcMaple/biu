import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  user: { isLogin: true, mid: 900001, uname: "普通 A" },
  hydrated: true,
  ready: true,
  update: vi.fn(),
  hydrate: vi.fn(),
  prepare: vi.fn(),
  flush: vi.fn(),
  onError: vi.fn(),
  toast: vi.fn(),
  decide: vi.fn(),
  offer: vi.fn(),
  closed: vi.fn(),
  read: vi.fn(),
  apply: vi.fn(),
  ensure: vi.fn(),
}));

vi.mock("@heroui/react", () => ({
  addToast: mock.toast,
  Spinner: ({ label }: { label: string }) => <span>{label}</span>,
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading,
  }: {
    children: ReactNode;
    onPress: () => void;
    isDisabled?: boolean;
    isLoading?: boolean;
  }) => (
    <button type="button" disabled={isDisabled || isLoading} onClick={onPress}>
      {children}
    </button>
  ),
  Modal: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
    isOpen ? <section role="dialog">{children}</section> : null,
  ModalContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ModalHeader: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  ModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}));
vi.mock("@/platform/web", () => ({ prepareWebPlaylistSession: mock.prepare }));
vi.mock("@/service/web-playlist-view", () => ({ applyWebPlaylistPartition: mock.apply }));
vi.mock("@/platform/web-playlist-runtime", () => ({
  flushWebPlaylistWrites: mock.flush,
  closeWebPlaylistSession: mock.closed,
  onWebPlaylistWriteError: mock.onError,
}));
vi.mock("@/store/user", () => ({
  useUser: Object.assign((selector: (state: { user: typeof mock.user }) => unknown) => selector({ user: mock.user }), {
    getState: () => ({ user: mock.user, updateUser: mock.update }),
    persist: { hasHydrated: () => mock.hydrated, onFinishHydration: vi.fn() },
  }),
}));
vi.mock("@/store/favorite", () => ({
  ensureLikedFolder: mock.ensure,
  useFavoritesStore: { persist: { rehydrate: mock.hydrate, hasHydrated: () => mock.ready } },
}));
vi.mock("@/store/local-fav-items", () => ({
  useLocalFavItemsStore: { persist: { rehydrate: mock.hydrate, hasHydrated: () => mock.ready } },
}));
vi.mock("@/store/tags", () => ({
  useTagStore: { persist: { rehydrate: mock.hydrate, hasHydrated: () => mock.ready } },
}));

import Boundary from "@/components/web-playlist-boundary";

let root: Root;
let container: HTMLDivElement;
const offer = { target: "account:900001", version: 1, items: [{ rid: 1, title: "合成歌曲", type: 2, fav_time: 100 }] };
const mount = async () =>
  act(async () => {
    root.render(
      <Boundary>
        <div data-testid="real-layout">原页面</div>
      </Boundary>,
    );
  });
const choose = async (name: string) =>
  act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find(button => button.textContent === name)!
      .click();
  });

describe("分区预览使用原页面和明确选择", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mock.user = { isLogin: true, mid: 900001, uname: "普通 A" };
    mock.hydrated = true;
    mock.ready = true;
    mock.update.mockResolvedValue(undefined);
    mock.hydrate.mockResolvedValue(undefined);
    mock.flush.mockResolvedValue(undefined);
    mock.offer.mockResolvedValue(offer);
    mock.decide.mockResolvedValue(1);
    mock.prepare.mockResolvedValue({
      scope: "account:900001",
      guestOffer: mock.offer,
      decideGuest: mock.decide,
      read: mock.read,
    });
    mock.read.mockResolvedValue({ accountSnapshot: true });
    mock.onError.mockReturnValue(() => undefined);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("身份、分区与hydration就绪后才显示原页面和明确账号目标", async () => {
    await mount();
    expect(mock.update).toHaveBeenCalledOnce();
    expect(mock.prepare).toHaveBeenCalledWith(900001);
    expect(mock.hydrate).toHaveBeenCalledTimes(3);
    expect(mock.ensure).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="real-layout"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("普通 A");
    expect(mock.decide).not.toHaveBeenCalled();
  });

  it("选择不并入只记选择，不重载歌曲或显示并入成功", async () => {
    await mount();
    mock.hydrate.mockClear();
    await choose("不并入");
    expect(mock.decide).toHaveBeenCalledWith(offer, "keep");
    expect(mock.hydrate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(mock.toast).not.toHaveBeenCalled();
  });

  it("选择并入等待落盘，再应用同账号快照并显示实际新增数", async () => {
    await mount();
    mock.hydrate.mockClear();
    await choose("并入");
    expect(mock.decide).toHaveBeenCalledWith(offer, "merge");
    expect(mock.hydrate).not.toHaveBeenCalled();
    expect(mock.apply).toHaveBeenCalledWith({ accountSnapshot: true });
    expect(mock.toast).toHaveBeenCalledWith({ title: "已并入 1 首歌曲", color: "success" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("重复资源只显示已在收藏中，不虚报新增歌曲", async () => {
    mock.decide.mockResolvedValue(0);
    await mount();
    await choose("并入");
    expect(mock.toast).toHaveBeenCalledWith({ title: "歌曲已在当前收藏中", color: "success" });
  });

  it("并入失败保留弹窗与原页面，可显式再试，成功后去掉旧错误", async () => {
    mock.decide.mockRejectedValueOnce(new Error("模拟事务失败，访客原件保留"));
    await mount();
    await choose("并入");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("访客原件保留");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(mock.toast).not.toHaveBeenCalled();
    await choose("并入");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("分区启动或hydration失败不展示空替身和旧账号页面", async () => {
    mock.prepare.mockRejectedValue(new Error("旧版收藏原件已保留"));
    await mount();
    expect(container.querySelector('[data-testid="real-layout"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("原件已保留");
  });

  it("hydration未完成时不启动收藏页面或询问", async () => {
    mock.ready = false;
    await mount();
    expect(container.querySelector('[data-testid="real-layout"]')).toBeNull();
    expect(mock.offer).not.toHaveBeenCalled();
  });

  it("没有访客红心时原页面正常显示且不弹窗", async () => {
    mock.offer.mockResolvedValue(null);
    await mount();
    expect(container.querySelector('[data-testid="real-layout"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
