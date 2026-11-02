import { useEffect, useState } from "react";

import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Textarea } from "@heroui/react";

import { useLyricsAlignSession } from "@/store/lyrics-align-session";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialLyrics: string;
}

// 管理员拿任意一份歌词插队对齐，判断是算法的问题还是歌词的问题；好了先试听，再决定采用和发布
const LyricsAlignModal = ({ isOpen, onOpenChange, initialLyrics }: Props) => {
  const [text, setText] = useState(initialLyrics);

  useEffect(() => {
    if (isOpen) setText(initialLyrics);
  }, [isOpen, initialLyrics]);

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} scrollBehavior="inside" size="2xl" disableAnimation>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          换一份歌词再对齐
          <span className="text-foreground/60 text-sm font-normal">
            插到队首、跳过缓存重跑，好了先试听，再决定采用和发布
          </span>
        </ModalHeader>
        <ModalBody>
          <Textarea value={text} onValueChange={setText} minRows={10} maxRows={18} aria-label="歌词" />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            color="primary"
            isDisabled={!text.trim()}
            onPress={() => {
              void useLyricsAlignSession.getState().start(text);
              onOpenChange(false);
            }}
          >
            开始对齐
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default LyricsAlignModal;
