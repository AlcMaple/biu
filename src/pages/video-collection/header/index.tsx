import { memo } from "react";

import { Link, Skeleton, User } from "@heroui/react";
import { RiEdit2Line } from "@remixicon/react";
import { useRequest } from "ahooks";
import clx from "classnames";

import { CollectionType } from "@/common/constants/collection";
import { useIsMobileLayout } from "@/common/hooks/use-responsive";
import { isPrivateFav } from "@/common/utils/fav";
import Image from "@/components/image";
import { isWeb } from "@/platform";
import { getWebInterfaceCard } from "@/service/user-account";

interface Props {
  loading?: boolean;
  type: CollectionType;
  attr?: number;
  cover?: string;
  title?: string;
  desc?: string;
  upMid?: number;
  mediaCount?: number;
  onEdit?: () => void;
}

const Header = memo(({ loading, type, attr, cover, title, desc, upMid, mediaCount, onEdit }: Props) => {
  const isMobileLayout = useIsMobileLayout();
  const { data: upInfo } = useRequest(
    async () => {
      const res = await getWebInterfaceCard({
        mid: upMid as number,
      });

      return res?.data;
    },
    {
      ready: Boolean(upMid),
      refreshDeps: [upMid],
    },
  );

  if (loading) {
    return (
      <div className={clx("mb-4 flex", isMobileLayout ? "gap-3" : "space-x-4")}>
        <Skeleton className={isMobileLayout ? "h-[118px] w-[140px]" : "h-[168px] w-[200px]"} />
        <div className={clx("flex min-w-0 flex-col items-start", isMobileLayout ? "gap-2" : "space-y-4")}>
          <Skeleton className={isMobileLayout ? "h-[24px] w-full" : "h-[24px] w-[200px]"} />
          <Skeleton className={isMobileLayout ? "h-[16px] w-full" : "h-[16px] w-[200px]"} />
          <Skeleton className={isMobileLayout ? "h-[16px] w-full" : "h-[16px] w-[200px]"} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={clx("mb-4 flex min-w-0", isMobileLayout ? "gap-3" : "space-x-4")}>
        <div className="group relative flex-none">
          <Image
            radius="md"
            src={cover}
            alt={title}
            width={isMobileLayout ? 140 : 200}
            height={isMobileLayout ? 118 : 168}
            params="672w_378h_1c.avif"
            className={clx({
              "border-content3 border": !cover,
            })}
          />
          {typeof onEdit === "function" && (
            <div
              className={clx(
                "absolute z-10 flex cursor-pointer items-center justify-center bg-black/60 text-white",
                isWeb
                  ? "top-2 right-2 size-10 rounded-full shadow-md"
                  : "inset-0 rounded-md opacity-0 transition-opacity group-hover:opacity-100",
              )}
              onClick={onEdit}
              onKeyDown={e => e.key === "Enter" && onEdit()}
              role="button"
              tabIndex={0}
              aria-label="修改封面"
            >
              <div className="flex flex-col items-center gap-2">
                <RiEdit2Line size={isWeb ? 20 : 28} />
                {!isWeb && <span className="text-sm">修改</span>}
              </div>
            </div>
          )}
        </div>
        <div className={clx("flex min-w-0 flex-1 flex-col items-start", isMobileLayout ? "gap-2" : "space-y-4")}>
          <h1
            className={clx(
              "max-w-full min-w-0 font-bold",
              isMobileLayout ? "line-clamp-2 text-2xl leading-tight" : "text-3xl",
            )}
          >
            {title}
          </h1>
          {Boolean(desc) && (
            <p className={clx("text-foreground-400 text-sm", isMobileLayout ? "line-clamp-2" : "line-clamp-1")}>
              {desc}
            </p>
          )}
          <div className="text-foreground-400 flex max-w-full flex-wrap items-center gap-x-1 text-sm">
            <span>
              {type === CollectionType.Favorite
                ? `${attr ? (isPrivateFav(attr as number) ? "私密" : "公开") : ""}收藏夹`
                : type === CollectionType.VideoSeries
                  ? "视频系列"
                  : "视频合集"}
            </span>
            <span>•</span>
            <span>{mediaCount} 条视频</span>
          </div>
          {Boolean(upMid) && (
            <User
              avatarProps={{
                size: "sm",
                src: upInfo?.card?.face,
              }}
              name={
                <Link color="foreground" href={`/user/${upMid}`} className="hover:underline">
                  {upInfo?.card?.name}
                </Link>
              }
              className="max-w-full justify-start"
            />
          )}
        </div>
      </div>
    </>
  );
});

export default Header;
