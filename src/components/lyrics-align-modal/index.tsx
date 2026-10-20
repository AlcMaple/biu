import { Modal, ModalBody, ModalContent, ModalHeader } from "@heroui/react";

import type { LyricLine } from "@/store/lyrics-state";

import { usePlayList } from "@/store/play-list";

import AlignTab from "./align-tab";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** 预填的歌词：从搜索结果点「自动对齐」时是那份歌词，从歌词面板进来时是当前歌词 */
  initialLyrics: string;
  onAdopted: (lines: LyricLine[], tLines: LyricLine[]) => void;
}

const LyricsAlignModal = ({ isOpen, onOpenChange, initialLyrics, onAdopted }: Props) => {
  const playItem = usePlayList(s => s.list.find(i => i.id === s.playId));

  const target =
    playItem && playItem.source !== "local" && playItem.bvid && playItem.cid
      ? { bvid: playItem.bvid, cid: String(playItem.cid), title: playItem.pageTitle || playItem.title }
      : null;

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} scrollBehavior="inside" size="3xl" disableAnimation>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          歌词逐字对齐
          {target ? <span className="text-foreground/60 text-sm font-normal">{target.title}</span> : null}
        </ModalHeader>
        <ModalBody className="pb-6">
          {target ? (
            <AlignTab
              key={`${target.bvid}-${target.cid}`}
              target={target}
              initialLyrics={initialLyrics}
              onAdopted={onAdopted}
            />
          ) : (
            <div className="text-foreground/60 py-8 text-center text-sm">
              只有 B 站投稿能自动对齐（服务器按投稿去取音频），本地音乐暂不支持
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default LyricsAlignModal;
