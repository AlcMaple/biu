import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { addToast, Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Spinner } from "@heroui/react";

import { prepareWebPlaylistSession } from "@/platform/web";
import {
  closeWebPlaylistSession,
  flushWebPlaylistWrites,
  onWebPlaylistWriteError,
} from "@/platform/web-playlist-runtime";
import { applyWebPlaylistPartition } from "@/service/web-playlist-view";
import { ensureLikedFolder, useFavoritesStore } from "@/store/favorite";
import { useLocalFavItemsStore } from "@/store/local-fav-items";
import { useTagStore } from "@/store/tags";
import { useUser } from "@/store/user";

type Session = Awaited<ReturnType<typeof prepareWebPlaylistSession>>;
type Offer = NonNullable<Awaited<ReturnType<Session["guestOffer"]>>>;

async function waitForUser() {
  if (useUser.persist.hasHydrated()) return;
  await new Promise<void>(resolve => {
    const unsubscribe = useUser.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

async function hydratePlaylists() {
  await Promise.all([
    useFavoritesStore.persist.rehydrate(),
    useLocalFavItemsStore.persist.rehydrate(),
    useTagStore.persist.rehydrate(),
  ]);
  if (![useFavoritesStore, useLocalFavItemsStore, useTagStore].every(store => store.persist.hasHydrated())) {
    throw new Error("收藏载入失败，原件已保留");
  }
  ensureLikedFolder();
}

export default function WebPlaylistBoundary({ children }: { children: ReactNode }) {
  const user = useUser(state => state.user);
  const [session, setSession] = useState<Session>();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const started = useRef<Promise<void> | null>(null);
  const mounted = useRef(false);
  const activeMid = user?.isLogin ? user.mid : null;
  const expectedScope = activeMid === null ? "guest" : `account:${activeMid}`;

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = onWebPlaylistWriteError(error => {
      if (mounted.current) setError(`收藏尚未保存：${error.message}`);
    });
    if (!started.current) {
      started.current = (async () => {
        await waitForUser();
        await useUser.getState().updateUser();
        const identity = useUser.getState().user;
        const next = await prepareWebPlaylistSession(identity?.isLogin ? identity.mid : null);
        await hydratePlaylists();
        await flushWebPlaylistWrites();
        const nextOffer = await next.guestOffer();
        if (mounted.current) {
          setSession(next);
          setOffer(nextOffer);
        }
      })().catch(error => {
        if (mounted.current) setError(error instanceof Error ? error.message : "收藏载入失败");
      });
    }
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || session.scope === expectedScope) return;
    // 身份变更用完整启动边界重载；旧页面的请求、默认歌单与输入状态不带入新身份。
    closeWebPlaylistSession();
    window.location.reload();
  }, [expectedScope, session]);

  const decide = async (choice: "merge" | "keep") => {
    if (!session || !offer) return;
    setError(undefined);
    setBusy(true);
    try {
      await flushWebPlaylistWrites();
      const added = await session.decideGuest(offer, choice);
      if (choice === "merge") applyWebPlaylistPartition(await session.read());
      if (mounted.current) {
        setOffer(null);
        if (choice === "merge")
          addToast({ title: added ? `已并入 ${added} 首歌曲` : "歌曲已在当前收藏中", color: "success" });
      }
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : "并入失败，访客收藏已保留");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (!session || session.scope !== expectedScope || (error && !offer)) {
    return (
      <div className="flex h-full items-center justify-center" role={error ? "alert" : "status"}>
        {error ? <span>{error}</span> : <Spinner label="正在载入收藏" />}
      </div>
    );
  }

  return (
    <>
      {error && !offer ? <div role="alert">{error}</div> : null}
      {children}
      <Modal isOpen={Boolean(offer)} hideCloseButton isDismissable={false} isKeyboardDismissDisabled>
        <ModalContent>
          <ModalHeader>并入访客收藏？</ModalHeader>
          <ModalBody>
            <p>
              将 {offer?.items.length} 首歌曲并入「{user?.uname ?? activeMid}」的我喜欢的音乐
            </p>
            {error ? <p role="alert">{error}</p> : null}
          </ModalBody>
          <ModalFooter>
            <Button isDisabled={busy} variant="light" onPress={() => void decide("keep")}>
              不并入
            </Button>
            <Button isLoading={busy} color="primary" onPress={() => void decide("merge")}>
              并入
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
