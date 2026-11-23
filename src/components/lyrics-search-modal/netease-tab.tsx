import { useCallback, useRef, useState } from "react";

import { Spinner, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, addToast } from "@heroui/react";

import type { EmptyLyricsSelection } from "@/components/lyrics/cache";

import { formatDuration } from "@/common/utils/time";
import { parseLrc } from "@/components/lyrics/parse-lrc";
import platform from "@/platform";
import { classifyLyricText } from "@shared/instrumental-lyrics";

import LyricsPreviewModal, { INSTRUMENTAL_PREVIEW_NOTE, type AdoptEmptyLyricsHandler } from "./lyrics-preview-modal";

export type AdoptLyricsHandler = (lyricsText: string, tLyricsText?: string) => Promise<boolean>;

interface NeteaseTabProps {
  songs: NeteaseSong[];
  loading: boolean;
  onAdoptLyrics: AdoptLyricsHandler;
  onAdoptEmpty: AdoptEmptyLyricsHandler;
}

const NeteaseTab = ({ songs, loading, onAdoptLyrics, onAdoptEmpty }: NeteaseTabProps) => {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [lyricsTitle, setLyricsTitle] = useState<string>("");
  const [lyrics, setLyrics] = useState<string>("");
  const [tlyrics, setTlyrics] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [emptySelection, setEmptySelection] = useState<EmptyLyricsSelection>();
  const requestRef = useRef(0);

  const renderDuration = (value?: number) => {
    const seconds = value ? Math.round(value / 1000) : undefined;
    if (!seconds) return "--";
    return formatDuration(seconds);
  };

  const renderArtists = (artists?: NeteaseArtist[]) => {
    if (!artists?.length) return "--";
    return artists
      .map(a => a.name)
      .filter(Boolean)
      .join(" / ");
  };

  const handleSelect = useCallback(async (song: NeteaseSong) => {
    const id = song.id;
    if (!id) {
      addToast({ title: "缺少歌曲 ID，无法预览", color: "warning" });
      return;
    }
    const request = ++requestRef.current;
    setLyrics("");
    setTlyrics("");
    setLyricsTitle(`${song.name || "未知歌曲"}-${renderArtists(song.artists)}`);
    setPreviewError("");
    setEmptySelection(undefined);
    setIsPreviewOpen(true);
    setPreviewLoading(true);

    try {
      const res = await platform.getNeteaseLyrics({ id });
      if (request !== requestRef.current) return;
      if (!res) {
        setPreviewError("网易云没有返回歌词数据。可以换个来源。");
        return;
      }
      const translation = res?.tlyric?.lyric?.trim() || "";
      if (res?.code !== undefined && res.code !== 200) {
        setPreviewError(`网易云歌词请求失败（业务码 ${res.code}）。可以换个来源。`);
        return;
      }
      const candidates = [res?.lrc?.lyric, res?.klyric?.lyric].map(raw => ({
        text: raw?.trim(),
        kind: classifyLyricText(raw),
      }));
      const text = candidates.find(value => value.kind === "text" && parseLrc(value.text).length)?.text;

      if (!text) {
        const hasText = candidates.some(value => value.kind === "text");
        if (!hasText) {
          setEmptySelection(candidates.some(value => value.kind === "instrumental") ? "instrumental" : "missing");
        }
        setPreviewError(
          hasText ? "网易云没有返回带时间轴的歌词。可以换个来源。" : "网易云没有返回这个版本的歌词。可以换个来源。",
        );
        return;
      }

      setLyrics(text);
      setTlyrics(translation);
    } catch {
      if (request !== requestRef.current) return;
      setPreviewError("网易云歌词请求失败。可以稍后再试，或换个来源。");
    } finally {
      if (request === requestRef.current) setPreviewLoading(false);
    }
  }, []);

  const handleAdopt = useCallback(
    async (lyricsText: string, tLyricsText?: string) => {
      if (!lyricsText) return;
      const ok = await onAdoptLyrics(lyricsText, tLyricsText);
      if (ok) {
        setIsPreviewOpen(false);
      }
    },
    [onAdoptLyrics],
  );
  const handleAdoptEmpty = useCallback<AdoptEmptyLyricsHandler>(
    async selection => {
      if (!(await onAdoptEmpty(selection))) return false;
      setIsPreviewOpen(false);
      return true;
    },
    [onAdoptEmpty],
  );

  return (
    <div className="h-[340px] overflow-auto">
      {loading ? (
        <div className="flex h-full items-center justify-center">
          <Spinner color="primary" label="加载中" />
        </div>
      ) : (
        <Table removeWrapper selectionMode="single" aria-label="netease songs">
          <TableHeader>
            <TableColumn width={200}>歌曲</TableColumn>
            <TableColumn>专辑</TableColumn>
            <TableColumn width={200}>歌手</TableColumn>
            <TableColumn width={90}>时长</TableColumn>
          </TableHeader>
          <TableBody emptyContent="网易云没搜到匹配的曲目" items={songs}>
            {song => (
              <TableRow key={song.id} onClick={() => handleSelect(song)} className="cursor-pointer">
                <TableCell>{song.name || "--"}</TableCell>
                <TableCell>{song.album?.name || "--"}</TableCell>
                <TableCell>{renderArtists(song.artists)}</TableCell>
                <TableCell>{renderDuration(song.duration)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <LyricsPreviewModal
        isOpen={isPreviewOpen}
        onOpenChange={open => {
          if (!open) requestRef.current += 1;
          setIsPreviewOpen(open);
        }}
        title={lyricsTitle}
        meta={emptySelection === "instrumental" ? INSTRUMENTAL_PREVIEW_NOTE : previewError}
        metaTone={emptySelection === "instrumental" ? "default" : "warning"}
        lyrics={lyrics}
        tlyrics={tlyrics}
        loading={previewLoading}
        onAdopt={handleAdopt}
        emptySelection={emptySelection}
        onAdoptEmpty={handleAdoptEmpty}
      />
    </div>
  );
};

export default NeteaseTab;
