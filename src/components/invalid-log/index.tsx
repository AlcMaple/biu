import { useState } from "react";

import { addToast, Button, Modal, ModalBody, ModalContent, ModalHeader } from "@heroui/react";

import { findAnother, removeInvalidItem, undoReplacement } from "@/common/utils/replace-invalid";
import { formatMillisecond } from "@/common/utils/time";
import { log as logger } from "@/platform";
import { type ReplaceLog, useLocalFavItemsStore } from "@/store/local-fav-items";

interface Props {
  folderId: number;
  isOpen: boolean;
  onClose: () => void;
  onManualSearch: (log: ReplaceLog) => void;
}

const EMPTY_LOGS: ReplaceLog[] = [];

const STATUS_LABEL: Record<ReplaceLog["status"], { text: string; className: string }> = {
  replaced: { text: "已替换", className: "bg-success/15 text-success" },
  pending: { text: "待处理", className: "bg-warning/15 text-warning" },
  error: { text: "搜索出错", className: "bg-danger/15 text-danger" },
};

const InvalidLogModal = ({ folderId, isOpen, onClose, onManualSearch }: Props) => {
  const logs = useLocalFavItemsStore(s => s.replaceLogs?.[folderId]) ?? EMPTY_LOGS;
  const [busyId, setBusyId] = useState<string | null>(null);

  const runFindAnother = async (entry: ReplaceLog) => {
    setBusyId(entry.id);
    try {
      const found = await findAnother(folderId, entry);
      if (!found) addToast({ title: "没有更多可信的候选了，可以自己搜索", color: "warning" });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "搜索失败";
      logger.warn("[invalid-log] 换一个失败", reason);
      addToast({ title: reason, color: "danger" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex-col items-start gap-1">失效记录</ModalHeader>
        <ModalBody className="pb-6">
          {!logs.length && (
            <div className="text-foreground-500 py-10 text-center text-sm">这个歌单暂时没有失效记录</div>
          )}
          <div className="flex flex-col gap-3">
            {logs.map(entry => {
              const status = STATUS_LABEL[entry.status];
              const busy = busyId === entry.id;
              return (
                <div key={entry.id} className="bg-content2 flex flex-col gap-2 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`rounded px-1.5 py-0.5 ${status.className}`}>{status.text}</span>
                    <span className="text-foreground-500">{formatMillisecond(entry.time)}</span>
                    {entry.status === "replaced" && (
                      <span className="text-foreground-500">{entry.mode === "auto" ? "自动" : "手动"}</span>
                    )}
                  </div>
                  <div className="text-foreground-500 line-clamp-2 text-sm line-through">{entry.original.title}</div>
                  {entry.status === "replaced" && entry.current && (
                    <div className="line-clamp-2 text-sm">→ {entry.current.title}</div>
                  )}
                  {entry.reason && <div className="text-foreground-500 text-xs">{entry.reason}</div>}
                  <div className="flex flex-wrap justify-end gap-2">
                    {entry.status === "replaced" && (
                      <>
                        <Button size="sm" variant="flat" isLoading={busy} onPress={() => void runFindAnother(entry)}>
                          换一个
                        </Button>
                        <Button
                          size="sm"
                          variant="light"
                          isDisabled={busy}
                          onPress={() => undoReplacement(folderId, entry)}
                        >
                          撤销
                        </Button>
                      </>
                    )}
                    {entry.status === "error" && (
                      <Button size="sm" variant="flat" isLoading={busy} onPress={() => void runFindAnother(entry)}>
                        重试
                      </Button>
                    )}
                    {entry.status !== "replaced" && (
                      <>
                        <Button size="sm" color="primary" onPress={() => onManualSearch(entry)}>
                          自己搜索
                        </Button>
                        <Button
                          size="sm"
                          variant="light"
                          color="danger"
                          onPress={() => removeInvalidItem(folderId, entry)}
                        >
                          删除
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default InvalidLogModal;
