/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks mirror existing hooks */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const viewRequest = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/service/request", () => ({ apiRequest: { get: viewRequest.get } }));

vi.mock("@heroui/react", () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Button = ({
    children,
    onPress,
    isDisabled,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    isDisabled?: boolean;
  }) => (
    <button type="button" disabled={isDisabled} onClick={onPress}>
      {children}
    </button>
  );
  return {
    addToast: vi.fn(),
    Button,
    Modal: ({ children, isOpen }: { children?: React.ReactNode; isOpen: boolean }) =>
      isOpen ? <div>{children}</div> : null,
    ModalBody: Box,
    ModalContent: Box,
    ModalFooter: Box,
    ModalHeader: Box,
    Radio: Box,
    RadioGroup: Box,
    Checkbox: ({
      isSelected,
      onChange,
      onClick,
      "aria-label": label,
    }: {
      isSelected: boolean;
      onChange?: () => void;
      onClick?: React.MouseEventHandler;
      "aria-label"?: string;
    }) => <input type="checkbox" checked={isSelected} onChange={onChange} onClick={onClick} aria-label={label} />,
  };
});
vi.mock("@/common/hooks/use-responsive", () => ({ useIsMobileLayout: () => false }));
vi.mock("@/components/scroll-container", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/tag-popover", () => ({
  TagPanel: ({ selectedIds }: { selectedIds: number[] }) => <div data-tags>{selectedIds.join(",")}</div>,
}));
vi.mock("@/store/heartbeat", () => ({ useHeartbeat: { getState: () => ({ noteFavoriteFromFm: vi.fn() }) } }));
vi.mock("@/store/play-list", () => ({ usePlayList: { getState: () => ({ getPlayItem: () => undefined }) } }));
vi.mock("@/store/music-fav", () => ({ useMusicFavStore: { getState: () => ({ refreshIsFav: vi.fn() }) } }));

import { toPlaybackFavoriteModalData } from "@/common/utils/fav";
import FavoritesSelectModal from "@/components/favorites-select-modal";
import { getWebInterfaceView } from "@/service/web-interface-view";
import { useFavoritesStore } from "@/store/favorite";
import { useLocalFavItemsStore, type LocalFavItem } from "@/store/local-fav-items";
import { useModalStore } from "@/store/modal";
import { useSettings } from "@/store/settings";
import { useTagStore, getItemTagKey } from "@/store/tags";
import { useUser } from "@/store/user";

let root: Root;
let container: HTMLDivElement;
const item: LocalFavItem = {
  rid: "987654",
  cid: "987654",
  bvid: "BV1xx411c7mD",
  type: 2,
  source: "online",
  title: "改过的歌名",
  page: 2,
  fav_time: 1,
};

beforeEach(() => {
  viewRequest.get.mockReset();
  useUser.setState({ user: null });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useFavoritesStore.setState({
    createdFavorites: [
      { id: -1, title: "已有", isLocal: true },
      { id: -2, title: "目标", isLocal: true },
    ] as ReturnType<typeof useFavoritesStore.getState>["createdFavorites"],
  });
  useLocalFavItemsStore.setState({ folderItems: { [-1]: [item], [-2]: [] } });
  useTagStore.setState({ tags: [{ id: 7, name: "分集标签", color: "red" }], itemTags: { [getItemTagKey(item)]: [7] } });
  useSettings.setState({ hiddenMenuKeys: [] });
  useModalStore.getState().onCloseFavSelectModal();
  act(() => root.render(<FavoritesSelectModal />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

test("首次打开即勾选已有收藏与分集标签，复制及重开不产生重复歌曲", async () => {
  const open = () =>
    useModalStore
      .getState()
      .onOpenFavSelectModal(
        toPlaybackFavoriteModalData(
          { id: "queue", type: "mv", aid: "123", bvid: item.bvid, cid: item.cid, title: "原稿" },
          Object.values(useLocalFavItemsStore.getState().folderItems).flat(),
        )!,
      );
  await act(async () => open());
  expect(container.querySelector('input[aria-label="已有"]')).toBeChecked();
  expect(container.querySelector("[data-tags]")).toHaveTextContent("7");
  expect([...container.querySelectorAll("button")].find(b => b.textContent === "确认")).toBeDisabled();
  await act(async () => (container.querySelector('input[aria-label="目标"]') as HTMLInputElement).click());
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "确认")!.click());
  expect(useLocalFavItemsStore.getState().folderItems[-1]).toHaveLength(1);
  expect(useLocalFavItemsStore.getState().folderItems[-2]).toHaveLength(1);
  expect(useLocalFavItemsStore.getState().folderItems[-2][0]).toMatchObject({
    rid: item.rid,
    cid: item.cid,
    title: item.title,
  });
  await act(async () => open());
  expect(container.querySelector('input[aria-label="已有"]')).toBeChecked();
  expect(container.querySelector('input[aria-label="目标"]')).toBeChecked();
  expect(container.querySelector("[data-tags]")).toHaveTextContent("7");
  expect([...container.querySelectorAll("button")].find(b => b.textContent === "确认")).toBeDisabled();
});

const openOnline = (bvid: string) =>
  useModalStore.getState().onOpenFavSelectModal({
    rid: 123,
    type: 2,
    itemInfo: { title: "搜索歌曲", bvid },
  });
const singlePage = { code: 0, data: { pages: [{ cid: 11, page: 1, part: "第一集" }] } };

test("播放取得单集元数据后，收藏不显示加载中且零新增请求", async () => {
  viewRequest.get.mockResolvedValue(singlePage);
  await getWebInterfaceView({ bvid: "cached-single" });
  await act(async () => openOnline("cached-single"));
  expect(container).not.toHaveTextContent("加载中");
  expect(container.querySelector('input[aria-label="已有"]')).toBeInTheDocument();
  expect(viewRequest.get).toHaveBeenCalledTimes(1);
});

test("缓存多集仍进入选集，取消冷请求后迟到结果不覆盖新弹窗", async () => {
  let resolve!: (value: typeof singlePage) => void;
  viewRequest.get.mockReturnValueOnce(
    new Promise(done => {
      resolve = done;
    }),
  );
  await act(async () => openOnline("slow-video"));
  expect(container).toHaveTextContent("加载中");
  await act(async () => useModalStore.getState().onCloseFavSelectModal());
  viewRequest.get.mockResolvedValue({
    code: 0,
    data: {
      pages: [
        { cid: 21, page: 1, part: "新视频第一集" },
        { cid: 22, page: 2, part: "新视频第二集" },
      ],
    },
  });
  await getWebInterfaceView({ bvid: "cached-multi" });
  await act(async () => openOnline("cached-multi"));
  expect(container).toHaveTextContent("收藏整个视频（共 2 集）");
  expect(container).toHaveTextContent("新视频第二集");
  await act(async () => resolve(singlePage));
  expect(container).toHaveTextContent("新视频第二集");
  expect(viewRequest.get).toHaveBeenCalledTimes(2);
});

test("失败明确提示且仅手动重试，不把未知分集当成单集", async () => {
  viewRequest.get.mockResolvedValueOnce({ code: -412 });
  await act(async () => openOnline("failed-video"));
  expect(container.querySelector('[role="alert"]')).toHaveTextContent("分集信息加载失败，请重试");
  expect([...container.querySelectorAll("button")].find(b => b.textContent === "确认")).toBeUndefined();
  expect(viewRequest.get).toHaveBeenCalledTimes(1);
  viewRequest.get.mockResolvedValueOnce(singlePage);
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "重试")!.click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('input[aria-label="已有"]')).toBeInTheDocument();
  expect(viewRequest.get).toHaveBeenCalledTimes(2);
});
