import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";

import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Progress,
  Tab,
  Tabs,
  addToast,
} from "@heroui/react";

import { lyricsSyncCache } from "@/store/lyrics-sync-cache";
import { usePlayList } from "@/store/play-list";

import ScrollContainer from "../scroll-container";

const stageLabel = (stage: "download" | "demucs" | "whisperx") => {
  if (stage === "download") return "下载音频";
  if (stage === "demucs") return "人声分离";
  return "歌词对齐";
};

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
  const [showSyncOptions, setShowSyncOptions] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ stage: "download" | "demucs" | "whisperx"; pct: number } | null>(
    null,
  );

  // Reset synced state whenever a new set of lyrics is shown; restore from cache if available
  useEffect(() => {
    setActiveTab("original");
    setSyncProgress(null);
    const cached = lyricsSyncCache.get(lyrics);
    setSyncedLyrics(cached ?? null);
  }, [isOpen, lyrics]);

  // Subscribe to background sync results while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const unsubDone = window.electron.onSyncLyricsWithWhisperXDone(({ syncedLrc, originalLrc, error }) => {
      if (originalLrc !== lyrics) return;
      setIsSyncing(false);
      setSyncProgress(null);
      if (error) {
        addToast({ title: `同步失败: ${error}`, color: "danger" });
      } else if (syncedLrc) {
        setSyncedLyrics(syncedLrc);
        onAdopt(syncedLrc.trim(), tlyrics);
      }
    });
    const unsubProgress = window.electron.onSyncLyricsWithWhisperXProgress(progress => {
      setSyncProgress(progress);
    });
    return () => {
      unsubDone();
      unsubProgress();
    };
  }, [isOpen, lyrics]);

  const displayedLyrics = syncedLyrics ?? lyrics;

  const handleAdopt = () => {
    onAdopt(displayedLyrics?.trim(), tlyrics);
  };

  const handleSync = () => {
    const playItem = getPlayItem();
    if (!playItem?.audioUrl) {
      addToast({ title: "无法获取当前播放音频链接，请确保正在播放中", color: "warning" });
      return;
    }
    if (!lyrics) {
      addToast({ title: "歌词内容为空", color: "warning" });
      return;
    }
    setShowSyncOptions(true);
  };

  const doSync = async (localFilePath?: string) => {
    const playItem = getPlayItem();
    const audioUrl = playItem?.audioUrl;
    if (!audioUrl) return;

    setShowSyncOptions(false);
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

    window.electron.startSyncLyricsWithWhisperX({ audioUrl: audioUrl, lrc: lyrics, localFilePath });
    addToast({ title: "歌词时间轴同步已在后台启动，完成后将通知您", color: "primary", timeout: 4000 });
  };

  const handleSelectLocalFile = async () => {
    const filePath = await window.electron.selectFile();
    if (!filePath) return;
    doSync(filePath);
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
        <ModalFooter className="flex-col gap-3">
          {showSyncOptions ? (
            <>
              <p className="text-foreground-500 w-full text-center text-sm">
                CDN 下载受网络影响较大且速度较慢，建议优先使用本地已下载的音频文件
              </p>
              <div className="flex w-full justify-center gap-2">
                <Button variant="flat" color="primary" onPress={handleSelectLocalFile}>
                  选择本地音频
                </Button>
                <Button variant="flat" onPress={() => setShowSyncOptions(false)}>
                  取消
                </Button>
                <Button variant="flat" onPress={() => doSync()}>
                  直接 CDN 下载
                </Button>
              </div>
            </>
          ) : (
            <div className="flex w-full flex-col gap-2">
              {isSyncing && syncProgress && (
                <Progress
                  size="sm"
                  value={syncProgress.pct}
                  label={stageLabel(syncProgress.stage)}
                  showValueLabel
                  classNames={{ label: "text-xs text-foreground-500", value: "text-xs text-foreground-500" }}
                />
              )}
              <div className="flex w-full justify-end gap-2">
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
              </div>
            </div>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default LyricsPreviewModal;
