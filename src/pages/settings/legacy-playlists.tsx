import { addToast, Button } from "@heroui/react";

import { useModalStore } from "@/store/modal";
import { switchPlaylistAccount } from "@/store/playlist-account";
import { usePlaylistSession } from "@/store/playlist-session";
import { useUser } from "@/store/user";

export default function LegacyPlaylists() {
  const session = usePlaylistSession();
  const user = useUser(s => s.user);
  if (!user || user.mid !== session.mid) return null;
  if (session.error)
    return (
      <div role="alert">
        {session.error} <Button onPress={() => void switchPlaylistAccount(user.mid)}>重新读取歌单</Button>
      </div>
    );
  if (!session.canClaim) return null;
  const confirm = () =>
    useModalStore.getState().onOpenConfirmModal({
      title: "认领升级前的本地歌单？",
      description: `旧歌单、歌曲和标签将合并到 ${user.uname}（UID ${user.mid}），并同步到这个账号。请确认归属。`,
      confirmText: "认领到此账号",
      onConfirm: async () => {
        if (usePlaylistSession.getState() !== session) return true;
        try {
          await switchPlaylistAccount(user.mid, true);
        } catch (error) {
          addToast({ title: error instanceof Error ? error.message : "认领旧歌单失败", color: "danger" });
          return false;
        }
        const next = usePlaylistSession.getState();
        if (next.mid === user.mid && next.ready) addToast({ title: "旧歌单已合并到当前账号", color: "success" });
        return true;
      },
    });
  return (
    <Button type="button" onPress={confirm}>
      认领升级前的本地歌单
    </Button>
  );
}
