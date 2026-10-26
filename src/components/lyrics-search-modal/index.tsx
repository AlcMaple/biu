import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Chip, Input, Modal, ModalBody, ModalContent, ModalHeader, Tab, Tabs, addToast } from "@heroui/react";

import type { LyricLine } from "@/store/lyrics-state";
import type { LyricsProvider } from "@shared/lyrics-format";
import type { ProviderLyricsCandidate } from "@shared/lyrics-providers";

import { extractSongInfo, extractTitleCandidates } from "@/components/lyrics/auto-match";
import { PROVIDER_LABELS, describeProviderError, linesOfEntry } from "@/components/lyrics/provider-lyrics";
import platform from "@/platform";
import { usePlayList } from "@/store/play-list";
import { StoreNameMap } from "@shared/store";

import type { AdoptLyricsHandler } from "./netease-tab";
import type { AdoptProviderLyricsHandler } from "./provider-tab";

import LrclibTab from "./lrclib-tab";
import NeteaseTab from "./netease-tab";
import ProviderTab from "./provider-tab";

const NETEASE_TYPE_SONG = 1;
const DEFAULT_LIMIT = 20;

type SearchTab = "netease" | "lrclib" | LyricsProvider;

const PROVIDER_TABS: LyricsProvider[] = ["qq", "kugou", "amll"];

const isProviderTab = (tab: SearchTab): tab is LyricsProvider => tab !== "netease" && tab !== "lrclib";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onLyricsAdopted?: (lyricsText?: string, tLyricsText?: string, lines?: LyricLine[]) => void;
}

const LyricsSearchModal = ({ isOpen, onOpenChange, onLyricsAdopted }: Props) => {
  const playId = usePlayList(state => state.playId);
  const getPlayItem = usePlayList(state => state.getPlayItem);
  const [keyword, setKeyword] = useState("");
  const [activeTab, setActiveTab] = useState<SearchTab>("netease");
  const [neteaseSongs, setNeteaseSongs] = useState<NeteaseSong[]>([]);
  const [lrclibSongs, setLrclibSongs] = useState<SearchSongByLrclibResponse[]>([]);
  const [neteaseLoading, setNeteaseLoading] = useState(false);
  const [lrclibLoading, setLrclibLoading] = useState(false);
  const [providerCandidates, setProviderCandidates] = useState<ProviderLyricsCandidate[]>([]);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerError, setProviderError] = useState<string>();
  const keywordRef = useRef("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // 换来源 / 再搜 / 切歌都换一代，慢的旧结果回来时直接丢掉
  const searchRef = useRef(0);

  const clearResults = useCallback(() => {
    searchRef.current += 1;
    setNeteaseSongs([]);
    setLrclibSongs([]);
    setProviderCandidates([]);
    setProviderError(undefined);
    setNeteaseLoading(false);
    setLrclibLoading(false);
    setProviderLoading(false);
  }, []);

  const resetState = useCallback(() => {
    setKeyword("");
    setActiveTab("netease");
    clearResults();
  }, [clearResults]);

  useEffect(() => {
    if (!isOpen) return;
    const playItem = getPlayItem();
    if (playItem) {
      const rawTitle = (playItem.pageTitle || playItem.title).trim();
      setKeyword(extractSongInfo(rawTitle).title);
      // 自动提取的歌名有时会选错；把其他候选、UP 主和完整原标题摆出来，点一下就搜，不用退出去查歌名
      setSuggestions(
        [...new Set([...extractTitleCandidates(rawTitle), playItem.ownerName?.trim() ?? "", rawTitle])].filter(Boolean),
      );
      clearResults();
    }
  }, [playId, isOpen, getPlayItem, clearResults]);

  useEffect(() => {
    keywordRef.current = keyword;
  }, [keyword]);

  const handleSubmit = useCallback(
    async (tab: SearchTab = activeTab) => {
      const query = keywordRef.current.trim();
      if (query === "") return;
      const search = ++searchRef.current;

      if (isProviderTab(tab)) {
        setNeteaseLoading(false);
        setLrclibLoading(false);
        setProviderError(undefined);
        setProviderLoading(true);
        try {
          const res = await platform.searchProviderLyrics({ provider: tab, title: query });
          if (search !== searchRef.current) return;
          setProviderCandidates(res.ok ? res.data : []);
          setProviderError(res.ok ? undefined : describeProviderError(res.error));
        } catch (err) {
          if (search !== searchRef.current) return;
          setProviderCandidates([]);
          setProviderError(`${PROVIDER_LABELS[tab]}搜索失败：${err instanceof Error ? err.message : String(err)}`);
        } finally {
          if (search === searchRef.current) setProviderLoading(false);
        }
        return;
      }

      if (tab === "netease") {
        setLrclibLoading(false);
        try {
          setNeteaseLoading(true);
          const res = await platform.searchNeteaseSongs({
            s: query,
            type: NETEASE_TYPE_SONG,
            limit: DEFAULT_LIMIT,
            offset: 0,
          });

          if (search !== searchRef.current) return;
          setNeteaseSongs(res?.result?.songs ?? []);
        } catch {
          setNeteaseSongs([]);
          addToast({ title: "网易云搜索失败", color: "danger" });
        } finally {
          setNeteaseLoading(false);
        }
      } else {
        setNeteaseLoading(false);
        try {
          setLrclibLoading(true);
          const res = await platform.searchLrclibLyrics({ q: query });
          if (search !== searchRef.current) return;
          setLrclibSongs(res ?? []);
        } catch {
          setLrclibSongs([]);
          addToast({ title: "LrcLib 搜索失败", color: "danger" });
        } finally {
          setLrclibLoading(false);
        }
      }
    },
    [activeTab],
  );

  useEffect(() => {
    if (isOpen) {
      void handleSubmit(activeTab);
    }
  }, [isOpen, activeTab, handleSubmit]);

  const saveLyrics = useCallback(
    async (
      lyricsText: string | undefined,
      tLyricsText: string | undefined,
      extra: Pick<MusicLyrics, "origin" | "nativeTiming">,
    ) => {
      if (!lyricsText && !tLyricsText) return false;

      const current = getPlayItem();
      if (!current) {
        addToast({ title: "当前播放信息缺失，无法保存歌词", color: "warning" });
        return false;
      }

      let key: string;
      if (current.source === "local") {
        key = `local-${current.id}`;
      } else {
        const cid = current.cid ? Number(current.cid) : undefined;
        if (!current.bvid || cid === undefined || Number.isNaN(cid)) {
          addToast({ title: "当前播放信息缺失，无法保存歌词", color: "warning" });
          return false;
        }
        key = `${current.bvid}-${current.cid}`;
      }

      const nextLyrics: MusicLyrics = {
        lyrics: lyricsText,
        tLyrics: tLyricsText,
        source: "manual",
        autoVersion: undefined,
        // 换了一份歌词，旧的逐字时间轴和对齐前备份都不再对应它
        alignment: undefined,
        preAlign: undefined,
        // 主动换了一份歌词，之前点「还原」留下的「别再自动对齐」不再适用
        noAutoAlign: undefined,
        // 网易云 / LrcLib 采用时显式清掉，免得上一份平台歌词的来源和逐字时间挂在新歌词上
        origin: extra.origin,
        nativeTiming: extra.nativeTiming,
        screenOrigin: undefined,
      };

      try {
        const store = await platform.getStore(StoreNameMap.LyricsCache);
        const prev = store?.[key] || {};
        const nextStore = { ...(store ?? {}), [key]: { ...prev, ...nextLyrics } };
        await platform.setStore(StoreNameMap.LyricsCache, nextStore);
        onLyricsAdopted?.(lyricsText, tLyricsText, linesOfEntry(nextLyrics));
        return true;
      } catch {
        addToast({ title: "歌词保存失败", color: "danger" });
        return false;
      }
    },
    [getPlayItem, onLyricsAdopted],
  );

  const handleAdoptLyrics = useCallback<AdoptLyricsHandler>(
    (lyricsText, tLyricsText) => saveLyrics(lyricsText, tLyricsText, { origin: undefined, nativeTiming: undefined }),
    [saveLyrics],
  );

  const handleAdoptProviderLyrics = useCallback<AdoptProviderLyricsHandler>(
    adoption =>
      saveLyrics(adoption.lyrics, adoption.tLyrics, { origin: adoption.origin, nativeTiming: adoption.nativeTiming }),
    [saveLyrics],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      onOpenChange(open);
      if (!open) {
        resetState();
      }
    },
    [onOpenChange, resetState],
  );

  return (
    <Modal isOpen={isOpen} onOpenChange={handleOpenChange} scrollBehavior="inside" size="4xl" disableAnimation>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">搜索歌词</ModalHeader>
        <ModalBody className="pb-6">
          <div className="flex gap-2">
            <Input
              value={keyword}
              onValueChange={setKeyword}
              placeholder="请输入歌曲或歌手名称"
              onKeyDown={e => {
                if (e.key === "Enter") handleSubmit(activeTab);
              }}
            />
            <Button color="primary" onPress={() => handleSubmit(activeTab)}>
              搜索
            </Button>
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-default-500 text-xs">试试：</span>
              {suggestions.map(text => (
                <Chip
                  key={text}
                  as="button"
                  type="button"
                  size="sm"
                  variant="flat"
                  className="max-w-[22rem] cursor-pointer"
                  classNames={{ content: "truncate" }}
                  onClick={() => {
                    keywordRef.current = text;
                    setKeyword(text);
                    void handleSubmit(activeTab);
                  }}
                >
                  {text}
                </Chip>
              ))}
            </div>
          )}
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={key => {
              setActiveTab(key as SearchTab);
              clearResults();
            }}
            classNames={{
              panel: "py-0",
            }}
          >
            <Tab key="netease" title="网易云" />
            <Tab key="lrclib" title="LrcLib" />
            {PROVIDER_TABS.map(provider => (
              <Tab key={provider} title={PROVIDER_LABELS[provider]} />
            ))}
          </Tabs>
          {activeTab === "netease" ? (
            <NeteaseTab songs={neteaseSongs} loading={neteaseLoading} onAdoptLyrics={handleAdoptLyrics} />
          ) : activeTab === "lrclib" ? (
            <LrclibTab songs={lrclibSongs} loading={lrclibLoading} onAdoptLyrics={handleAdoptLyrics} />
          ) : (
            <ProviderTab
              provider={activeTab}
              candidates={providerCandidates}
              loading={providerLoading}
              error={providerError}
              onAdopt={handleAdoptProviderLyrics}
            />
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default LyricsSearchModal;
