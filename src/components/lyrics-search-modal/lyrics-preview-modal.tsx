import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";

import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tab, Tabs, addToast } from "@heroui/react";

import { lyricsSyncCache } from "@/store/lyrics-sync-cache";
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

  // Reset synced state whenever a new set of lyrics is shown; restore from cache if available
  useEffect(() => {
    setActiveTab("original");
    const cached = lyricsSyncCache.get(lyrics);
    setSyncedLyrics(cached ?? null);
  }, [isOpen, lyrics]);

  // Subscribe to background sync results while modal is open
  useEffect(() => {
    if (!isOpen) return;
    return window.electron.onSyncLyricsWithWhisperXDone(({ syncedLrc, originalLrc, error }) => {
      if (originalLrc !== lyrics) return;
      setIsSyncing(false);
      if (error) {
        addToast({ title: `同步失败: ${error}`, color: "danger" });
      } else if (syncedLrc) {
        setSyncedLyrics(syncedLrc);
      }
    });
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

    const check = await window.electron.checkWhisperXDeps();
    if (!check.ok) {
      if (check.missingDep && check.missingDep !== "python") {
        addToast({
          title: `正在安装 ${check.missingDep} 等依赖，请稍候（可能需要数分钟）...`,
          color: "primary",
          timeout: 0,
        });
        const install = await window.electron.installWhisperXDeps();
        if (!install.ok) {
          addToast({ title: install.error ?? "安装依赖失败", color: "danger" });
          setIsSyncing(false);
          return;
        }
        const recheck = await window.electron.checkWhisperXDeps();
        if (!recheck.ok) {
          addToast({ title: recheck.error ?? "依赖验证失败", color: "danger" });
          setIsSyncing(false);
          return;
        }
      } else {
        addToast({ title: check.error ?? "依赖检查失败", color: "danger" });
        setIsSyncing(false);
        return;
      }
    }

    window.electron.startSyncLyricsWithWhisperX({ audioUrl, lrc: lyrics });
    addToast({ title: "歌词时间轴同步已在后台启动，完成后将通知您", color: "primary", timeout: 4000 });
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
            <Button variant="flat" onPress={() => setSyncedLyrics(null)}>
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
          <Button color="primary" onPress={handleAdopt} isDisabled={loading}>
            采用歌词
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default LyricsPreviewModal;
