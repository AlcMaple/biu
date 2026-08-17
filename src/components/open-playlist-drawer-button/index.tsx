import { RiPlayListLine } from "@remixicon/react";

import IconButton from "@/components/icon-button";
import { useModalStore } from "@/store/modal";

const OpenPlaylistDrawerButton = () => {
  const setOpen = useModalStore(s => s.setPlayListDrawerOpen);

  return (
    <IconButton aria-label="播放列表" onPress={() => setOpen(true)}>
      <RiPlayListLine size={18} />
    </IconButton>
  );
};

export default OpenPlaylistDrawerButton;
