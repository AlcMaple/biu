import { useCallback, useState } from "react";

import { Spinner, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@heroui/react";

import { formatDuration } from "@/common/utils/time";
import { parseLrc } from "@/components/lyrics/parse-lrc";
import { classifyLyricText } from "@shared/instrumental-lyrics";

import type { AdoptLyricsHandler } from "./netease-tab";

import LyricsPreviewModal, { INSTRUMENTAL_PREVIEW_NOTE, type AdoptEmptyLyricsHandler } from "./lyrics-preview-modal";

interface LrclibTabProps {
  songs: SearchSongByLrclibResponse[];
  loading: boolean;
  onAdoptLyrics: AdoptLyricsHandler;
  onAdoptEmpty: AdoptEmptyLyricsHandler;
}

const LrclibTab = ({ songs, loading, onAdoptLyrics, onAdoptEmpty }: LrclibTabProps) => {
  const [selected, setSelected] = useState<SearchSongByLrclibResponse>();
  const timed = classifyLyricText(selected?.syncedLyrics);
  const plain = classifyLyricText(selected?.plainLyrics);
  const instrumental =
    selected?.instrumental === true ||
    (timed !== "text" && plain !== "text" && (timed === "instrumental" || plain === "instrumental"));
  const lyrics =
    !instrumental && timed === "text" && parseLrc(selected?.syncedLyrics).length
      ? selected?.syncedLyrics?.trim() || ""
      : "";
  const hasText = plain === "text" || timed === "text";
  const previewNote = instrumental
    ? INSTRUMENTAL_PREVIEW_NOTE
    : selected && !lyrics
      ? hasText
        ? "LrcLib 只有纯文本歌词，没有时间轴。可以换个来源。"
        : "LrcLib 只有曲目信息，没有歌词。可以换个来源。"
      : undefined;

  const renderDuration = (value?: number) => {
    if (!value) return "--";
    return formatDuration(value);
  };

  const handleAdopt = useCallback(
    async (text: string) => {
      if (text && (await onAdoptLyrics(text))) setSelected(undefined);
    },
    [onAdoptLyrics],
  );
  const handleAdoptEmpty = useCallback<AdoptEmptyLyricsHandler>(
    async selection => {
      if (!(await onAdoptEmpty(selection))) return false;
      setSelected(undefined);
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
        <Table removeWrapper selectionMode="single" aria-label="lrclib songs">
          <TableHeader>
            <TableColumn width={200}>歌曲</TableColumn>
            <TableColumn>专辑</TableColumn>
            <TableColumn width={200}>歌手</TableColumn>
            <TableColumn width={90}>时长</TableColumn>
          </TableHeader>
          <TableBody emptyContent="LrcLib 没搜到匹配的曲目" items={songs}>
            {item => (
              <TableRow key={item.id} onClick={() => setSelected(item)} className="cursor-pointer">
                <TableCell>{item.trackName || item.name || "--"}</TableCell>
                <TableCell>{item.albumName || "--"}</TableCell>
                <TableCell>{item.artistName || "--"}</TableCell>
                <TableCell>{renderDuration(item.duration)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <LyricsPreviewModal
        isOpen={Boolean(selected)}
        onOpenChange={open => !open && setSelected(undefined)}
        title={selected && [selected.trackName || selected.name, selected.artistName].filter(Boolean).join(" - ")}
        meta={previewNote}
        metaTone={!instrumental && !lyrics ? "warning" : "default"}
        lyrics={lyrics}
        onAdopt={handleAdopt}
        emptySelection={instrumental ? "instrumental" : !hasText ? "missing" : undefined}
        onAdoptEmpty={handleAdoptEmpty}
      />
    </div>
  );
};

export default LrclibTab;
