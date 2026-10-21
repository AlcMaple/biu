import { useCallback, useEffect, useRef, useState } from "react";

import { Chip, Spinner, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@heroui/react";

import type { LyricsProvider } from "@shared/lyrics-format";
import type { ProviderLyricsCandidate } from "@shared/lyrics-providers";

import { formatDuration } from "@/common/utils/time";
import {
  PROVIDER_LABELS,
  buildProviderAdoption,
  describeProviderError,
  type ProviderAdoption,
} from "@/components/lyrics/provider-lyrics";
import platform from "@/platform";
import { usePlayList } from "@/store/play-list";

import LyricsPreviewModal from "./lyrics-preview-modal";

export type AdoptProviderLyricsHandler = (adoption: ProviderAdoption) => Promise<boolean>;

interface ProviderTabProps {
  provider: LyricsProvider;
  candidates: ProviderLyricsCandidate[];
  loading: boolean;
  error?: string;
  onAdopt: AdoptProviderLyricsHandler;
}

const TIMING_LABEL = { word: "逐字", line: "逐行" } as const;

const ProviderTab = ({ provider, candidates, loading, error, onAdopt }: ProviderTabProps) => {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [meta, setMeta] = useState("");
  const [adoption, setAdoption] = useState<ProviderAdoption | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  // 每次点选 / 关闭都换一代：慢的旧请求回来时代数不对就丢掉，不会把上一首的歌词塞进当前预览
  const requestRef = useRef(0);
  // 打开预览时在播的那首；采用时已经切歌就拒绝，免得把歌词存到别的歌上
  const playIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    requestRef.current += 1;
    setIsPreviewOpen(false);
  }, [provider, candidates]);

  const handleSelect = useCallback(async (candidate: ProviderLyricsCandidate) => {
    const request = ++requestRef.current;
    playIdRef.current = usePlayList.getState().playId;
    setTitle(`${candidate.title || "未知歌曲"}-${candidate.artists.join(" / ") || "未知歌手"}`);
    setMeta("");
    setAdoption(null);
    setPreviewError("");
    setIsPreviewOpen(true);
    setPreviewLoading(true);

    try {
      const result = await platform.getProviderLyrics({
        provider: candidate.provider,
        id: candidate.id,
        durationMs: candidate.durationMs,
        title: candidate.title,
        artist: candidate.artists.join("、"),
      });
      if (request !== requestRef.current) return;
      if (!result.ok) {
        setPreviewError(describeProviderError(result.error));
        return;
      }
      const next = buildProviderAdoption(result.data, candidate);
      setAdoption(next);
      setMeta(
        [
          `${PROVIDER_LABELS[candidate.provider]} · ${next.origin.format.toUpperCase()} · ${TIMING_LABEL[next.origin.timing]}`,
          next.origin.author ? `歌词作者 ${next.origin.author}` : "",
          next.origin.timing === "word" ? "逐字时间来自原唱录音，采用后仍会按当前视频重新对齐" : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (err) {
      if (request !== requestRef.current) return;
      setPreviewError(`获取歌词失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (request === requestRef.current) setPreviewLoading(false);
    }
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) requestRef.current += 1;
    setIsPreviewOpen(open);
  }, []);

  const handleAdopt = useCallback(async () => {
    if (!adoption) return;
    if (usePlayList.getState().playId !== playIdRef.current) {
      setPreviewError("已经切到别的歌了，这份歌词没有保存；请重新搜索");
      setAdoption(null);
      return;
    }
    if (await onAdopt(adoption)) handleOpenChange(false);
  }, [adoption, onAdopt, handleOpenChange]);

  const renderBody = () => {
    if (loading) {
      return (
        <div className="flex h-full items-center justify-center">
          <Spinner color="primary" label="加载中" />
        </div>
      );
    }
    if (error) {
      return (
        <div className="text-danger flex h-full items-center justify-center px-6 text-center text-sm">{error}</div>
      );
    }
    return (
      <Table
        removeWrapper
        selectionMode="single"
        aria-label={`${PROVIDER_LABELS[provider]} songs`}
        onRowAction={key => {
          const item = candidates.find(candidate => candidate.id === key);
          if (item) void handleSelect(item);
        }}
      >
        <TableHeader>
          <TableColumn width={200}>歌曲</TableColumn>
          <TableColumn>专辑</TableColumn>
          <TableColumn width={180}>歌手</TableColumn>
          <TableColumn width={80}>时长</TableColumn>
          <TableColumn width={90}>时间轴</TableColumn>
        </TableHeader>
        <TableBody emptyContent={`${PROVIDER_LABELS[provider]}没有搜到，可以换个关键词或来源`} items={candidates}>
          {item => (
            <TableRow key={item.id} className="cursor-pointer">
              <TableCell>{item.title || "--"}</TableCell>
              <TableCell>{item.album || "--"}</TableCell>
              <TableCell>{item.artists.join(" / ") || "--"}</TableCell>
              <TableCell>{item.durationMs ? formatDuration(Math.round(item.durationMs / 1000)) : "--"}</TableCell>
              <TableCell>
                {item.timing ? (
                  <Chip size="sm" variant="flat" color={item.timing === "word" ? "primary" : "default"}>
                    {TIMING_LABEL[item.timing]}
                  </Chip>
                ) : (
                  <span className="text-foreground/50 text-xs">预览后可知</span>
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    );
  };

  return (
    <div className="h-[340px] overflow-auto">
      {renderBody()}
      <LyricsPreviewModal
        isOpen={isPreviewOpen}
        onOpenChange={handleOpenChange}
        title={title}
        meta={previewError || meta}
        metaTone={previewError ? "danger" : "default"}
        lyrics={adoption?.lyrics ?? ""}
        tlyrics={adoption?.tLyrics}
        loading={previewLoading || !adoption}
        onAdopt={handleAdopt}
      />
    </div>
  );
};

export default ProviderTab;
