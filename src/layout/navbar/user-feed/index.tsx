import { useState } from "react";
import { useNavigate } from "react-router";

import { Badge, Button } from "@heroui/react";
import { RiTeamLine } from "@remixicon/react";
import { useRequest } from "ahooks";

import PlatformTooltip from "@/components/platform-tooltip";
import { getWebDynamicFeedAllUpdate } from "@/service/web-dynamic";

const UserFeed = () => {
  const navigate = useNavigate();
  const [updateCount, setUpdateCount] = useState(0);

  useRequest(
    async () => {
      const res = await getWebDynamicFeedAllUpdate({
        type: "video",
        update_baseline: 0,
        web_location: "333.1365",
      });
      return res;
    },
    {
      pollingInterval: 300000,
      pollingWhenHidden: false,
      onSuccess: res => {
        if (res.code === 0) {
          setUpdateCount(res.data?.update_num ?? 0);
        }
      },
      onError: () => {
        setUpdateCount(0);
      },
    },
  );

  const handleOpen = () => {
    setUpdateCount(0);
    navigate("/dynamic-feed");
  };

  const button = (
    <Button isIconOnly size="sm" variant="light" onPress={handleOpen} aria-label="动态" className="hover:text-primary">
      <RiTeamLine size={20} />
    </Button>
  );

  return (
    <>
      <PlatformTooltip closeDelay={0} content="动态">
        {updateCount > 0 ? (
          <Badge
            isDot
            color="warning"
            shape="circle"
            content=""
            size="sm"
            variant="solid"
            className="translate-x-1/3 -translate-y-1/3"
          >
            {button}
          </Badge>
        ) : (
          button
        )}
      </PlatformTooltip>
    </>
  );
};

export default UserFeed;
