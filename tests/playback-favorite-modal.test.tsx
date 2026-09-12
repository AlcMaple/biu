/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks mirror existing hooks */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

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
import { useFavoritesStore } from "@/store/favorite";
import { useLocalFavItemsStore, type LocalFavItem } from "@/store/local-fav-items";
import { useModalStore } from "@/store/modal";
import { useSettings } from "@/store/settings";
import { useTagStore, getItemTagKey } from "@/store/tags";

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
