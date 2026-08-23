import { useNavigate } from "react-router";

import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Avatar,
  useDisclosure,
  addToast,
  type DropdownItemProps,
} from "@heroui/react";
import {
  RiExternalLinkLine,
  RiFeedbackLine,
  RiLoginCircleLine,
  RiLogoutCircleLine,
  RiProfileLine,
  RiRefreshLine,
  RiSettings3Line,
} from "@remixicon/react";
import { twMerge } from "tailwind-merge";

import { useIsMobileLayout } from "@/common/hooks/use-responsive";
import platform, { isWeb, log } from "@/platform";
import { postPassportLoginExit } from "@/service/passport-login-exit";
import { logoutWebAuthSession, refreshWebAuthSession } from "@/service/web-auth";
import { useFavoritesStore } from "@/store/favorite";
import { useModalStore } from "@/store/modal";
import { usePlayList } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";
import { useSettings } from "@/store/settings";
import { useToken } from "@/store/token";
import { useUser } from "@/store/user";

import Login from "../login";

interface UserCardProps {
  onDropdownOpenChange?: (open: boolean) => void;
}

const UserCard = ({ onDropdownOpenChange }: UserCardProps) => {
  const user = useUser(s => s.user);
  const clearUser = useUser(s => s.clear);
  const clearToken = useToken(s => s.clear);
  const navigate = useNavigate();
  const updateSettings = useSettings(s => s.update);
  const isMobileLayout = useIsMobileLayout();

  const { isOpen: isLoginModalOpen, onOpen: openLoginModal, onOpenChange: onLoginModalOpenChange } = useDisclosure();

  const onOpenConfirmModal = useModalStore(s => s.onOpenConfirmModal);

  const logout = async () => {
    try {
      let loggedOut = false;
      if (isWeb) {
        const response = await logoutWebAuthSession();
        loggedOut = response.code === 0;
      } else {
        const csrfToken = await platform.getCookie("bili_jct");
        if (!csrfToken) {
          addToast({
            title: "CSRF Token 不存在",
            color: "danger",
          });
          return false;
        }

        const response = await postPassportLoginExit({ biliCSRF: csrfToken });
        loggedOut = response?.code === 0;
        if (!loggedOut) {
          addToast({ title: response?.message || "退出登录失败", color: "danger" });
          return false;
        }
      }

      if (!loggedOut) return false;
      clearToken();
      clearUser();
      updateSettings({
        hiddenMenuKeys: [],
      });
      usePlayList.getState().clear();
      useFavoritesStore.setState({
        createdFavorites: [],
        collectedFavorites: [],
      });
      usePlayProgress.setState({
        currentTime: 0,
      });
      navigate("/");
      return true;
    } catch (error) {
      log.warn("[logout] 退出登录失败", error);
      addToast({ title: "退出登录失败", color: "danger" });
      return false;
    }
  };

  const dropdownItems: (DropdownItemProps & { label: string; hidden?: boolean })[] = [
    {
      key: "login",
      label: "登录",
      startContent: <RiLoginCircleLine size={18} />,
      hidden: user?.isLogin,
      onPress: openLoginModal,
    },
    {
      key: "profile",
      label: "个人资料",
      startContent: <RiProfileLine size={18} />,
      hidden: !user?.isLogin,
      onPress: () => navigate(`/user/${user?.mid}`),
    },
    {
      key: "settings",
      label: "设置",
      startContent: <RiSettings3Line size={18} />,
      onPress: () => navigate("/settings"),
    },
    {
      key: "refresh",
      label: "刷新数据",
      startContent: <RiRefreshLine size={18} />,
      onPress: async () => {
        try {
          if (isWeb) {
            const response = await refreshWebAuthSession();
            if (response.code !== 0) throw new Error(response.message || "Web 会话刷新失败");
          }
          await useUser.getState().updateUser();
          const mid = useUser.getState().user?.mid;
          if (mid) {
            await useFavoritesStore.getState().updateCreatedFavorites(mid);
            await useFavoritesStore.getState().updateCollectedFavorites(mid);
          }
          addToast({
            title: "数据刷新成功",
            color: "success",
          });
        } catch {
          addToast({
            title: "刷新数据失败",
            color: "danger",
          });
        }
      },
    },
    {
      key: "feedback",
      label: "问题反馈",
      startContent: <RiFeedbackLine size={18} />,
      endContent: <RiExternalLinkLine size={18} />,
      onPress: () => platform.openExternal("https://github.com/wood3n/biu/issues"),
    },
    {
      key: "logout",
      label: "退出登录",
      startContent: <RiLogoutCircleLine size={18} />,
      color: "danger" as const,
      className: "text-danger",
      hidden: !user?.isLogin,
      onPress: () => {
        onOpenConfirmModal({
          title: "确认退出登录？",
          type: "danger",
          onConfirm: async () => {
            return logout();
          },
        });
      },
    },
  ].filter(item => !item.hidden);

  return (
    <>
      <Dropdown
        shouldBlockScroll={false}
        triggerScaleOnOpen={false}
        radius="md"
        classNames={{
          content: "min-w-[140px]",
        }}
        onOpenChange={onDropdownOpenChange}
      >
        <DropdownTrigger>
          <Avatar
            isBordered
            showFallback
            size="sm"
            as="button"
            type="button"
            className={
              isMobileLayout
                ? "cursor-pointer transition-transform hover:scale-105"
                : "mr-4 cursor-pointer transition-transform hover:scale-105"
            }
            src={user?.face}
          />
        </DropdownTrigger>
        <DropdownMenu aria-label="用户操作" variant="flat" items={dropdownItems}>
          {({ key, label, className, ...rest }) => (
            <DropdownItem className={twMerge("rounded-medium", className)} key={key} {...rest}>
              {label}
            </DropdownItem>
          )}
        </DropdownMenu>
      </Dropdown>
      <Login isOpen={isLoginModalOpen} onOpenChange={onLoginModalOpenChange} />
    </>
  );
};

export default UserCard;
