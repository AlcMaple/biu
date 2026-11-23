import { useEffect, useState } from "react";

import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tab, Tabs } from "@heroui/react";

import type { EmptyLyricsSelection } from "@/components/lyrics/cache";

import ScrollContainer from "../scroll-container";

export type AdoptEmptyLyricsHandler = (selection: EmptyLyricsSelection) => Promise<boolean>;

interface LyricsPreviewModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  /** 来源 / 时间轴类型等说明，或取词失败的原因 */
  meta?: string;
  metaTone?: "default" | "warning" | "danger";
  lyrics: string;
  tlyrics?: string;
  onAdopt?: (lyricsText: string, tLyricsText?: string) => void;
  emptySelection?: EmptyLyricsSelection;
  onAdoptEmpty?: AdoptEmptyLyricsHandler;
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
  emptySelection,
  onAdoptEmpty,
  loading,
}: LyricsPreviewModalProps) => {
  const [activeTab, setActiveTab] = useState<"original" | "translation">("original");

  useEffect(() => {
    setActiveTab("original");
  }, [isOpen, lyrics]);

  const metaClass = { default: "text-foreground/60", warning: "text-warning", danger: "text-danger" }[metaTone];
  const hasLyrics = Boolean(lyrics.trim());

  return (
    <Modal disableAnimation isOpen={isOpen} radius="md" onOpenChange={onOpenChange} placement="center" size="xl">
      <ModalContent>
        <ModalHeader>{title || "歌词预览"}</ModalHeader>
        <ModalBody className="px-0">
          {meta && <p className={`px-4 text-xs whitespace-pre-line ${metaClass}`}>{meta}</p>}
          {loading ? (
            <p className="text-foreground/60 px-4 text-sm">正在获取歌词…</p>
          ) : hasLyrics ? (
            <>
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
                  {activeTab === "original" ? lyrics : tlyrics}
                </pre>
              </ScrollContainer>
            </>
          ) : null}
        </ModalBody>
        <ModalFooter className="flex-col gap-3">
          <div className="flex w-full flex-col gap-2">
            <div className="flex w-full justify-end gap-2">
              <Button variant="light" onPress={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button
                color="primary"
                onPress={() => {
                  if (emptySelection) void onAdoptEmpty?.(emptySelection);
                  else onAdopt?.(lyrics.trim(), tlyrics);
                }}
                isDisabled={loading || (emptySelection ? !onAdoptEmpty : !hasLyrics || !onAdopt)}
              >
                {emptySelection === "instrumental"
                  ? "采用纯音乐"
                  : emptySelection === "missing"
                    ? "采用无歌词版本"
                    : "采用歌词"}
              </Button>
            </div>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default LyricsPreviewModal;

export const INSTRUMENTAL_PREVIEW_NOTE = "此来源标记为纯音乐。";
