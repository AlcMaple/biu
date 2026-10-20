import { useEffect, useState } from "react";

import {
  Alert,
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
  addToast,
} from "@heroui/react";

import { AlignApiError, submitLyrics } from "@/service/lyrics-align";
import { currentAlignTarget, useLyricsAlignSession } from "@/store/lyrics-align-session";

export type LyricsEditMode = "upload" | "align";

interface Props {
  mode: LyricsEditMode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialLyrics: string;
}

const COPY: Record<LyricsEditMode, { title: string; hint: string; action: string }> = {
  upload: {
    title: "上传我的歌词",
    hint: "带时间的 LRC 或纯文本都行，制作人员信息不用删。服务器会先按这首歌的音频逐字对齐，审核通过后所有人打开这首歌都用它",
    action: "上传",
  },
  align: {
    title: "换一份歌词再对齐",
    hint: "管理员调试用：插到队首、跳过缓存重跑，好了先试听，再决定采用和发布",
    action: "开始对齐",
  },
};

// 普通用户上传自己的歌词进审核；管理员可以拿任意一份歌词插队对齐，判断是算法的问题还是歌词的问题
const LyricsAlignModal = ({ mode, isOpen, onOpenChange, initialLyrics }: Props) => {
  const [text, setText] = useState(initialLyrics);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // 失败写在弹窗里，不用 toast：toast 弹在右下角，正好盖住弹窗的「上传」按钮，改完歌词再点会点到 toast 上
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setText(initialLyrics);
    setNote("");
    setError(null);
  }, [isOpen, initialLyrics]);

  const confirm = async () => {
    if (mode === "align") {
      void useLyricsAlignSession.getState().start(text);
      onOpenChange(false);
      return;
    }
    const target = currentAlignTarget();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await submitLyrics({
        bvid: target.bvid,
        cid: target.cid,
        lyrics: text,
        title: target.title,
        note: note.trim() || undefined,
      });
      addToast({
        title: "已上传，审核通过后所有人都会用这份歌词",
        description: "审核结果在侧边栏「我的提交」里",
        color: "success",
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof AlignApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = COPY[mode];
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} scrollBehavior="inside" size="2xl" disableAnimation>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          {copy.title}
          <span className="text-foreground/60 text-sm font-normal">{copy.hint}</span>
        </ModalHeader>
        <ModalBody>
          <Textarea
            value={text}
            onValueChange={value => {
              setText(value);
              setError(null);
            }}
            minRows={10}
            maxRows={18}
            aria-label="歌词"
          />
          {mode === "upload" ? (
            <Input
              size="sm"
              value={note}
              onValueChange={setNote}
              placeholder="备注（可选），比如歌词出处、改了哪几句"
              maxLength={200}
            />
          ) : null}
          {error ? <Alert color="danger" title={error} /> : null}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            取消
          </Button>
          <Button color="primary" isDisabled={!text.trim()} isLoading={busy} onPress={() => void confirm()}>
            {copy.action}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default LyricsAlignModal;
