import { useEffect, useRef, useState } from "react";

import { addToast, Button, Input, Modal, ModalBody, ModalContent, ModalHeader, Spinner } from "@heroui/react";

import type { SearchVideoItem } from "@/service/web-interface-search-type";

import { formatNumber } from "@/common/utils/number";
import { applyReplacement, getOrCreateLog, getSongKeyword, searchVideoPage } from "@/common/utils/replace-invalid";
import { stripHtml } from "@/common/utils/str";
import { openBiliVideoLink } from "@/common/utils/url";
import Image from "@/components/image";
import { log } from "@/platform";
import { type LocalFavItem, useLocalFavItemsStore } from "@/store/local-fav-items";

interface Props {
  folderId: number;
  target: LocalFavItem | null;
  onClose: () => void;
}

const ManualSearchModal = ({ folderId, target, onClose }: Props) => {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<SearchVideoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const pageRef = useRef({ page: 0, total: 1, keyword: "" });

  const run = async (kw: string, page: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await searchVideoPage(kw, page);
      pageRef.current = { page, total: res.numPages, keyword: kw };
      setResults(prev => (page === 1 ? res.list : [...prev, ...res.list]));
      setSearched(true);
    } catch (err) {
      log.warn("[invalid-log] 手动搜索替代视频失败", err instanceof Error ? err.message : err);
      setError(err instanceof Error ? err.message : "搜索失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!target) return;
    const kw = getSongKeyword(target.title);
    setKeyword(kw);
    setResults([]);
    setSearched(false);
    setError(null);
    if (kw) void run(kw, 1);
  }, [target]);

  const replaceWith = (cand: SearchVideoItem) => {
    if (!target) return;
    const inFolder = useLocalFavItemsStore.getState().folderItems[folderId] ?? [];
    const logEntry = getOrCreateLog(folderId, target);
    applyReplacement(folderId, logEntry, cand, "manual");
    addToast({
      title: inFolder.some(i => i.bvid === cand.bvid) ? "歌单里已有这个视频，已移除失效项" : "已替换",
      color: "success",
    });
    onClose();
  };

  const { page, total, keyword: lastKeyword } = pageRef.current;

  return (
    <Modal isOpen={!!target} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex-col items-start gap-1">
          自己搜索替代视频
          <span className="text-foreground-500 w-full truncate text-xs font-normal">失效：{target?.title}</span>
        </ModalHeader>
        <ModalBody className="pb-6">
          <Input
            value={keyword}
            onValueChange={setKeyword}
            placeholder="输入歌名搜索"
            size="sm"
            onKeyDown={e => {
              if (e.key === "Enter" && keyword.trim()) void run(keyword.trim(), 1);
            }}
            endContent={
              <Button
                size="sm"
                color="primary"
                isDisabled={!keyword.trim() || loading}
                onPress={() => void run(keyword.trim(), 1)}
              >
                {error ? "重试" : "搜索"}
              </Button>
            }
          />
          {error && <div className="text-danger py-4 text-center text-sm">{error}</div>}
          {loading && !results.length && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm">
              <Spinner size="sm" />
              搜索中…
            </div>
          )}
          {searched && !loading && !error && !results.length && (
            <div className="text-foreground-500 py-8 text-center text-sm">没有找到相关视频，换个关键词试试</div>
          )}
          <div className="flex flex-col gap-2">
            {results.map(cand => (
              <div key={cand.bvid} className="flex items-center gap-3">
                <Image src={cand.pic} width={96} height={60} className="flex-none rounded-md object-cover" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="line-clamp-2 text-sm">{stripHtml(cand.title)}</div>
                  <div className="text-foreground-500 text-xs">
                    {cand.author}
                    {cand.play ? ` · 播放 ${formatNumber(cand.play)}` : ""}
                    {cand.duration ? ` · ${cand.duration}` : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="light"
                  onPress={() => openBiliVideoLink({ type: "mv", bvid: cand.bvid })}
                  className="shrink-0"
                >
                  在 B 站打开
                </Button>
                <Button size="sm" color="primary" onPress={() => replaceWith(cand)} className="shrink-0">
                  替换
                </Button>
              </div>
            ))}
          </div>
          {results.length > 0 && page < total && (
            <Button variant="flat" size="sm" isLoading={loading} onPress={() => void run(lastKeyword, page + 1)}>
              加载更多
            </Button>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default ManualSearchModal;
