import React from "react";
import { useNavigate } from "react-router";

import { Avatar, Button, Card, CardBody, addToast } from "@heroui/react";
import { RiFlashlightFill, RiGroupLine, RiUserUnfollowLine } from "@remixicon/react";

import type { RelationListItem } from "@/service/relation-followings";
import type { RelationTagUser } from "@/service/relation-tag";

import { useIsMobileLayout } from "@/common/hooks/use-responsive";
import { isWeb } from "@/platform";
import { UserRelationAction, postRelationModify } from "@/service/relation-modify";
import { useModalStore } from "@/store/modal";

interface Props {
  u: RelationListItem | RelationTagUser;
  refresh: () => void;
  onSetGroup: (u: RelationListItem | RelationTagUser) => void;
}

const UserCard = ({ u, refresh, onSetGroup }: Props) => {
  const isMobileLayout = useIsMobileLayout();
  const navigate = useNavigate();
  const onOpenConfirmModal = useModalStore(s => s.onOpenConfirmModal);

  const handleUnfollow = async () => {
    onOpenConfirmModal({
      title: `取消关注 ${u.uname}`,
      type: "danger",
      confirmText: "取消关注",
      onConfirm: async () => {
        try {
          const res = await postRelationModify({ fid: u.mid, act: UserRelationAction.Unfollow });
          if (res?.code !== 0) {
            addToast({
              title: "取消关注失败",
              color: "danger",
            });
            return false;
          }
          addToast({
            title: "取消关注成功",
            color: "success",
          });
          refresh();
          return true;
        } catch {
          addToast({
            title: "取消关注失败",
            color: "danger",
          });
          return false;
        }
      },
    });
  };

  const handleSetGroup = () => {
    onSetGroup(u);
  };

  return (
    <Card
      key={u.mid}
      radius="md"
      as="div"
      isHoverable={!isWeb}
      isPressable
      onPress={() => navigate(`/user/${u.mid}`)}
      className="group relative h-full w-full overflow-hidden"
    >
      <CardBody
        className={
          isMobileLayout
            ? "flex items-center space-y-2 overflow-hidden p-2"
            : "flex items-center space-y-2 overflow-hidden p-4"
        }
      >
        <div className={isMobileLayout ? "relative h-20 w-20 flex-none" : "relative h-32 w-32 flex-none"}>
          <Avatar
            className={isMobileLayout ? "text-large h-20 w-20" : "text-large h-32 w-32"}
            src={`${u.face}@160w_160h_1c_1s.webp`}
            name={u.uname}
          />
          {u.official_verify?.type === 0 && (
            <div className="bg-warning ring-background absolute right-1 bottom-1 flex h-6 w-6 items-center justify-center rounded-full text-white ring-2">
              <RiFlashlightFill size={14} />
            </div>
          )}
          {u.official_verify?.type === 1 && (
            <div className="bg-primary ring-background absolute right-1 bottom-1 flex h-6 w-6 items-center justify-center rounded-full text-white ring-2">
              <RiFlashlightFill size={14} />
            </div>
          )}
        </div>
        <div className="flex w-full min-w-0 flex-col items-center space-y-1">
          <span
            className={isMobileLayout ? "max-w-full min-w-0 truncate text-sm" : "max-w-full min-w-0 truncate text-lg"}
          >
            {u.uname}
          </span>
          <span className="text-foreground-500 line-clamp-2 w-full text-center text-sm">{u.sign}</span>
        </div>
      </CardBody>

      <div
        onPointerDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        className={`bg-background/70 absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full border border-white/10 px-1 py-1 shadow-lg backdrop-blur-xl backdrop-saturate-150 ${
          isMobileLayout
            ? "w-[calc(100%-16px)]"
            : `w-max ${isWeb ? "translate-y-0" : "translate-y-20 transition-all duration-300 ease-in-out group-hover:translate-y-0"}`
        }`}
      >
        <Button
          size="sm"
          variant="light"
          radius="full"
          onPress={handleSetGroup}
          aria-label="设置分组"
          title={isWeb ? undefined : "设置分组"}
          startContent={<RiGroupLine size={18} />}
        >
          {isMobileLayout ? null : "设置分组"}
        </Button>
        <Button
          size="sm"
          color="danger"
          variant="light"
          radius="full"
          onPress={handleUnfollow}
          aria-label="取消关注"
          title={isWeb ? undefined : "取消关注"}
          startContent={<RiUserUnfollowLine size={18} />}
        >
          {isMobileLayout ? null : "取消关注"}
        </Button>
      </div>
    </Card>
  );
};

export default UserCard;
