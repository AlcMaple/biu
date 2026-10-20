import { useEffect, useState } from "react";

import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Textarea } from "@heroui/react";

import { useLyricsAlignSession } from "@/store/lyrics-align-session";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialLyrics: string;
}

// 只在要换歌词时才打开；平时「对齐当前歌词」一键开始，进度和试听都在歌词区顶部的提示条里
const LyricsAlignModal = ({ isOpen, onOpenChange, initialLyrics }: Props) => {
  const [text, setText] = useState(initialLyrics);

  useEffect(() => {
    if (isOpen) setText(initialLyrics);
  }, [isOpen, initialLyrics]);

  const start = () => {
    void useLyricsAlignSession.getState().start(text, { skipApproved: true });
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} scrollBehavior="inside" size="2xl" disableAnimation>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          换一份歌词再对齐
          <span className="text-foreground/60 text-sm font-normal">
            带时间的 LRC 或纯文本都行，制作人员信息不用删。想从网易云 / LrcLib 挑，可以在「搜索歌词」里选「采用并对齐」
          </span>
        </ModalHeader>
        <ModalBody>
          <Textarea value={text} onValueChange={setText} minRows={10} maxRows={18} aria-label="要对齐的歌词" />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            取消
          </Button>
          <Button color="primary" isDisabled={!text.trim()} onPress={start}>
            开始对齐
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default LyricsAlignModal;
