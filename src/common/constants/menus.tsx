import {
  RiDiscLine,
  RiDiscFill,
  RiHeartPulseLine,
  RiHeartPulseFill,
  RiUserFollowLine,
  RiUserFollowFill,
  RiFileDownloadLine,
  RiFileDownloadFill,
  RiHistoryLine,
  RiHistoryFill,
  RiCalendarScheduleLine,
  RiCalendarScheduleFill,
  RiFolderMusicLine,
  RiFolderMusicFill,
  RiTrophyLine,
  RiTrophyFill,
  RiShieldCheckLine,
  RiShieldCheckFill,
  RiFileEditLine,
  RiFileEditFill,
} from "@remixicon/react";

import { type MenuItemProps } from "@/components/menu/menu-item";

export type DefaultMenuItem = MenuItemProps & {
  needLogin?: boolean;
  // 审核员身份由对齐服务按登录账号判定，非审核员连设置里的开关也不该看到
  needReviewer?: boolean;
  hideOnWeb?: boolean;
};

export const DefaultMenuList: DefaultMenuItem[] = [
  {
    title: "推荐音乐",
    href: "/",
    icon: RiDiscLine,
    activeIcon: RiDiscFill,
  },
  {
    title: "私人FM",
    href: "/heartbeat",
    icon: RiHeartPulseLine,
    activeIcon: RiHeartPulseFill,
  },
  {
    title: "我的关注",
    href: "/follow",
    needLogin: true,
    icon: RiUserFollowLine,
    activeIcon: RiUserFollowFill,
  },
  {
    title: "稍后再看",
    href: "/later",
    needLogin: true,
    icon: RiCalendarScheduleLine,
    activeIcon: RiCalendarScheduleFill,
  },
  {
    title: "历史记录",
    href: "/history",
    needLogin: true,
    icon: RiHistoryLine,
    activeIcon: RiHistoryFill,
  },
  {
    title: "听歌排行",
    href: "/play-ranking",
    icon: RiTrophyLine,
    activeIcon: RiTrophyFill,
  },
  {
    title: "本地音乐",
    href: "/local-music",
    icon: RiFolderMusicLine,
    activeIcon: RiFolderMusicFill,
    hideOnWeb: true,
  },
  {
    title: "下载记录",
    href: "/download-list",
    icon: RiFileDownloadLine,
    activeIcon: RiFileDownloadFill,
  },
  {
    title: "我的提交",
    href: "/lyrics-submissions",
    needLogin: true,
    icon: RiFileEditLine,
    activeIcon: RiFileEditFill,
  },
  {
    title: "歌词审核",
    href: "/lyrics-review",
    needLogin: true,
    needReviewer: true,
    icon: RiShieldCheckLine,
    activeIcon: RiShieldCheckFill,
  },
];

export const getDefaultMenuList = (isWeb: boolean) => DefaultMenuList.filter(item => !(isWeb && item.hideOnWeb));
