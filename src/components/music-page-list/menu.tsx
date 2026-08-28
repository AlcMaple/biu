import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, useDisclosure } from "@heroui/react";
import { RiDeleteBinLine, RiExternalLinkLine, RiMoreFill } from "@remixicon/react";

import { openBiliVideoLink } from "@/common/utils/url";
import { isWeb } from "@/platform";
import { usePlayList, type PlayData } from "@/store/play-list";

interface Props {
  data: PlayData;
}

const Menus = ({ data }: Props) => {
  const delPage = usePlayList(state => state.delPage);
  const { isOpen, onOpenChange } = useDisclosure();

  return (
    <span
      className="flex flex-none"
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <Dropdown
        disableAnimation
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        classNames={{
          content: "min-w-fit",
        }}
      >
        <DropdownTrigger>
          <Button
            isIconOnly
            variant="light"
            size="sm"
            className={
              isWeb
                ? "flex-none"
                : `flex-none transition-opacity duration-200 ${isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"} group-hover:pointer-events-auto group-hover:opacity-100`
            }
            aria-label="播放列表操作菜单"
          >
            <RiMoreFill size={16} />
          </Button>
        </DropdownTrigger>
        <DropdownMenu aria-label="播放列表操作菜单">
          <DropdownItem
            key="bililink"
            startContent={<RiExternalLinkLine size={16} />}
            onPress={() => {
              openBiliVideoLink(data);
            }}
          >
            在 B 站打开
          </DropdownItem>
          <DropdownItem
            key="del"
            color="danger"
            startContent={<RiDeleteBinLine size={16} />}
            onPress={() => delPage(data.id)}
          >
            从列表删除
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>
    </span>
  );
};

export default Menus;
