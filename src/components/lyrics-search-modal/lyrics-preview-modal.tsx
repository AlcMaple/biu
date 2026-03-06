import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";

import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tab, Tabs, addToast } from "@heroui/react";

import { usePlayList } from "@/store/play-list";

import ScrollContainer from "../scroll-container";

interface LyricsPreviewModalProps {
  isOpen: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  title?: string;
  lyrics: string;
  tlyrics?: string;
  onAdopt: (lyricsText: string, tLyricsText?: string) => void;
  loading?: boolean;
}

const LyricsPreviewModal = ({
  isOpen,
  onOpenChange,
  title,
  lyrics,
  tlyrics,
  onAdopt,
  loading,
}: LyricsPreviewModalProps) => {
  const getPlayItem = usePlayList(state => state.getPlayItem);
  const [activeTab, setActiveTab] = useState<"original" | "translation">("original");
  const [syncedLyrics, setSyncedLyrics] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Reset synced state whenever a new set of lyrics is shown
  useEffect(() => {
    setSyncedLyrics(null);
    setActiveTab("original");
  }, [isOpen, lyrics]);

  const displayedLyrics = syncedLyrics ?? lyrics;

  const handleAdopt = () => {
    onAdopt(displayedLyrics?.trim(), tlyrics);
  };

  const handleSync = async () => {
    const playItem = getPlayItem();
    const audioUrl = playItem?.audioUrl;

    if (!audioUrl) {
      addToast({ title: "无法获取当前播放音频链接，请确保正在播放中", color: "warning" });
      return;
    }
    if (!lyrics) {
      addToast({ title: "歌词内容为空", color: "warning" });
      return;
    }

    setIsSyncing(true);
    try {
      const synced = await window.electron.syncLyricsWithWhisperX({ audioUrl, lrc: lyrics });
      setSyncedLyrics(synced);
      addToast({ title: "时间轴同步成功", color: "success" });
    } catch (err) {
      addToast({
        title: `同步失败: ${err instanceof Error ? err.message : "未知错误"}`,
        color: "danger",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Modal disableAnimation isOpen={isOpen} radius="md" onOpenChange={onOpenChange} placement="center" size="xl">
      <ModalContent>
        <ModalHeader>{title || "歌词预览"}</ModalHeader>
        <ModalBody className="px-0">
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={key => setActiveTab(key as "original" | "translation")}
            className="px-4"
          >
            <Tab key="original" title={syncedLyrics ? "同步后歌词" : "歌词原文"} />
            {Boolean(tlyrics) && <Tab key="translation" title="歌词翻译" />}
          </Tabs>
          <ScrollContainer className="px-4">
            <pre className="text-foreground/90 max-h-[420px] text-sm leading-relaxed break-words whitespace-pre-wrap">
              {activeTab === "original" ? displayedLyrics || "暂无歌词" : tlyrics || "暂无歌词"}
            </pre>
          </ScrollContainer>
        </ModalBody>
        <ModalFooter className="justify-end gap-2">
          <Button variant="light" onPress={() => onOpenChange(false)}>
            关闭
          </Button>
          {syncedLyrics && (
            <Button variant="flat" onPress={() => setSyncedLyrics(null)} isDisabled={isSyncing}>
              恢复原歌词
            </Button>
          )}
          <Button
            variant="flat"
            onPress={handleSync}
            isDisabled={loading || isSyncing || !lyrics}
            isLoading={isSyncing}
          >
            {syncedLyrics ? "重新同步" : "同步时间轴"}
          </Button>
          <Button color="primary" onPress={handleAdopt} isDisabled={loading || isSyncing}>
            采用歌词
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default LyricsPreviewModal;
