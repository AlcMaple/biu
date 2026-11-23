import { isOfflineDemo } from "@/common/offline-demo";
import { usePlaylistSession } from "./playlist-session";
import { useUser } from "./user";

export function playlistWriteIssue(action: string): string | undefined {
  if (isOfflineDemo) return;
  const user = useUser.getState().user;
  if (!user?.isLogin || !user.mid) return `登录后才能${action}`;
  const session = usePlaylistSession.getState();
  if (session.mid !== user.mid || !session.ready) return session.error || "正在读取本账号的歌单";
}
