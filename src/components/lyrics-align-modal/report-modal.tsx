import { useEffect, useState } from "react";

import {
  Alert,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
  addToast,
} from "@heroui/react";

import { AlignApiError, reportAlignment } from "@/service/lyrics-align";
import { currentAlignTarget } from "@/store/lyrics-align-session";

interface Props {
  // 报的是正在显示的那份逐字歌词；没有逐字歌词时不打开
  lyricsHash: string | null;
  onClose: () => void;
}

const ReportModal = ({ lyricsHash, onClose }: Props) => {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // 失败写在弹窗里而不是 toast，理由同上传弹窗：toast 会盖住「发送」按钮
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lyricsHash) return;
    setNote("");
    setError(null);
  }, [lyricsHash]);

  const send = async () => {
    const target = currentAlignTarget();
    if (!target || !lyricsHash) return;
    setBusy(true);
    setError(null);
    try {
      await reportAlignment({ bvid: target.bvid, cid: target.cid, lyricsHash, note: note.trim() || undefined });
      addToast({
        title: "已告诉管理员，谢谢",
        description: "处理结果在侧边栏「我的提交」里",
        color: "success",
      });
      onClose();
    } catch (err) {
      setError(err instanceof AlignApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={Boolean(lyricsHash)} onOpenChange={open => !open && onClose()} disableAnimation>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          报错：时间轴不对
          <span className="text-foreground/60 text-sm font-normal">
            管理员会试听这首歌；确认有误就下线这份逐字歌词，所有人退回原来的歌词
          </span>
        </ModalHeader>
        <ModalBody>
          <Textarea
            value={note}
            onValueChange={setNote}
            minRows={3}
            maxLength={200}
            placeholder="哪里不对（可选），比如「第二段整体慢半拍」「副歌那几句字亮得太早」"
            aria-label="哪里不对"
          />
          {error ? <Alert color="danger" title={error} /> : null}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            取消
          </Button>
          <Button color="primary" isLoading={busy} onPress={() => void send()}>
            发送
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ReportModal;
