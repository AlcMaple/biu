import { useEffect, useState } from "react";

import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tab, Tabs } from "@heroui/react";

import ScrollContainer from "../scroll-container";

interface LyricsPreviewModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  /** 来源 / 时间轴类型等说明，或取词失败的原因 */
  meta?: string;
  metaTone?: "default" | "danger";
  lyrics: string;
  tlyrics?: string;
  onAdopt: (lyricsText: string, tLyricsText?: string) => void;
  loading?: boolean;
}

const LyricsPreviewModal = ({
  isOpen,
  onOpenChange,
  title,
  meta,
  metaTone = "default",
  lyrics,
  tlyrics,
  onAdopt,
  loading,
}: LyricsPreviewModalProps) => {
  const [activeTab, setActiveTab] = useState<"original" | "translation">("original");

  useEffect(() => {
    setActiveTab("original");
  }, [isOpen, lyrics]);

  const handleAdopt = () => {
    onAdopt(lyrics?.trim(), tlyrics);
  };

  return (
    <Modal disableAnimation isOpen={isOpen} radius="md" onOpenChange={onOpenChange} placement="center" size="xl">
      <ModalContent>
        <ModalHeader>{title || "歌词预览"}</ModalHeader>
        <ModalBody className="px-0">
          {meta && (
            <p
              className={`px-4 text-xs whitespace-pre-line ${metaTone === "danger" ? "text-danger" : "text-foreground/60"}`}
            >
              {meta}
            </p>
          )}
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={key => setActiveTab(key as "original" | "translation")}
            className="px-4"
          >
            <Tab key="original" title="歌词原文" />
            {Boolean(tlyrics) && <Tab key="translation" title="歌词翻译" />}
          </Tabs>
          <ScrollContainer className="px-4">
            <pre className="text-foreground/90 max-h-[420px] text-sm leading-relaxed break-words whitespace-pre-wrap">
              {loading && !lyrics
                ? metaTone === "danger"
                  ? ""
                  : "加载中…"
                : activeTab === "original"
                  ? lyrics || "暂无歌词"
                  : tlyrics || "暂无歌词"}
            </pre>
          </ScrollContainer>
        </ModalBody>
        <ModalFooter className="flex-col gap-3">
          <div className="flex w-full flex-col gap-2">
            <div className="flex w-full justify-end gap-2">
              <Button variant="light" onPress={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button color="primary" onPress={handleAdopt} isDisabled={loading}>
                采用歌词
              </Button>
            </div>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default LyricsPreviewModal;
