import { Chip } from "@heroui/react";

import PlatformTooltip from "@/components/platform-tooltip";
import { useAppUpdateStore } from "@/store/app-update";
import { useModalStore } from "@/store/modal";

const AppUpdateNotify = () => {
  const isUpdateAvailable = useAppUpdateStore(s => s.isUpdateAvailable);
  const onOpenReleaseNoteModal = useModalStore(s => s.onOpenReleaseNoteModal);

  if (!isUpdateAvailable) return null;

  return (
    <PlatformTooltip closeDelay={0} content="有新版本更新" placement="bottom">
      <Chip variant="dot" size="sm" color="success" className="cursor-pointer" onClick={onOpenReleaseNoteModal}>
        New
      </Chip>
    </PlatformTooltip>
  );
};

export default AppUpdateNotify;
