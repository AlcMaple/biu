import { extractSongInfo, titleIncludesSong } from "@/components/lyrics/auto-match";
import { getWebInterfaceWbiSearchType, type SearchVideoItem } from "@/service/web-interface-search-type";
import { type LocalFavItem, type ReplaceLog, useLocalFavItemsStore } from "@/store/local-fav-items";

import { stripHtml } from "./str";
import { parseDuration } from "./time";
import { formatUrlProtocol } from "./url";

// 自动替换只信「歌名对得上且时长接近」的候选；宁可留给用户，也不静默换成别的歌
const DURATION_TOLERANCE_SEC = 15;
// 每个失效项最多翻 3 页，避免为了「换一个」连续打搜索接口
const MAX_PAGES = 3;
// 自动搜索的请求之间至少隔这么久，失效项再多也是排队慢慢处理，不打满搜索限流
const REQUEST_GAP_MS = 2000;

let lastRequestAt = 0;
const pace = async () => {
  const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
  lastRequestAt = Math.max(Date.now(), lastRequestAt + REQUEST_GAP_MS);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
};

export const getSongKeyword = (title: string) => extractSongInfo(stripHtml(title)).title;

export const isTrustedCandidate = (songName: string, originalDuration: number | undefined, cand: SearchVideoItem) => {
  if (!titleIncludesSong(stripHtml(cand.title), songName)) return false;
  const duration = parseDuration(cand.duration);
  if (!originalDuration || !duration) return true;
  return Math.abs(duration - originalDuration) <= DURATION_TOLERANCE_SEC;
};

// 仅开发环境：失效记录演示数据用，让界面和交互不依赖真实的 B 站搜索
let mockSearch = false;

const mockSearchPage = async (keyword: string, page: number) => {
  await new Promise(resolve => setTimeout(resolve, 400));
  const list = Array.from({ length: 6 }, (_, i) => ({
    aid: 70_000_000 + page * 100 + i,
    bvid: `BVmock${page}${i}`,
    title: `${keyword} 模拟投稿 ${page}-${i + 1}`,
    author: `模拟UP主${i + 1}`,
    pic: "",
    mid: i + 1,
    play: (i + 1) * 12345,
    duration: `4:2${i}`,
  }));
  return { list, numPages: 2 };
};

export const seedDebugInvalidLogs = (folderId: number, source: LocalFavItem) => {
  mockSearch = true;
  const store = useLocalFavItemsStore.getState();
  const base = 90_000_000_000 + Math.floor(Math.random() * 1_000_000);
  const fakes = ["演示 失效视频 A", "演示 失效视频 B", "演示 失效视频 C"].map((name, i) => ({
    ...source,
    rid: base + i,
    bvid: `BVdebug${base + i}`,
    cid: undefined,
    title: `【${name}】晴天 - 周杰伦`,
    duration: 260,
  }));
  fakes.forEach(item => store.addItem(folderId, item));
  const ids = new Set(fakes.map(i => String(i.rid)));
  store.updateInvalidFlags(folderId, ids, ids);
  const originals = useLocalFavItemsStore
    .getState()
    .folderItems[folderId].filter(i => ids.has(String(i.rid)))
    .sort((a, b) => Number(a.rid) - Number(b.rid));
  const [a, b, c] = originals.map(original => ({ ...newLog(original), time: Date.now() }));
  applyReplacement(
    folderId,
    a,
    {
      aid: 70_000_001,
      bvid: "BVmock01",
      title: "晴天 模拟投稿 0-1",
      author: "模拟UP主1",
      pic: "",
      mid: 1,
      duration: "4:21",
    },
    "auto",
  );
  store.upsertReplaceLog(folderId, { ...b, reason: "没有找到可信的同名视频" });
  store.upsertReplaceLog(folderId, { ...c, status: "error", reason: "搜索被 B 站临时拦截，请稍等一会儿再试" });
};

export const searchVideoPage = async (keyword: string, page: number) => {
  if (import.meta.env.DEV && mockSearch) return mockSearchPage(keyword, page);
  const res = await getWebInterfaceWbiSearchType<SearchVideoItem>({
    search_type: "video",
    keyword,
    page,
    page_size: 20,
    order: "totalrank",
  });
  if (res?.code !== 0 || !Array.isArray(res.data?.result)) {
    throw new Error(res?.code === -412 ? "搜索被 B 站临时拦截，请稍等一会儿再试" : `搜索失败（错误码 ${res?.code}）`);
  }
  return { list: res.data.result, numPages: res.data.numPages ?? 1 };
};

/** 逐个给出可信候选；已看过、原失效视频和歌单里已有的 bvid 都不会再出现 */
export const createCandidateFinder = (original: LocalFavItem, folderId: number, tried: string[]) => {
  const seen = new Set(tried);
  if (original.bvid) seen.add(original.bvid);
  const keyword = getSongKeyword(original.title);
  const duration = parseDuration(original.duration);
  const queue: SearchVideoItem[] = [];
  let page = 0;
  let noMore = !keyword;

  return {
    seen,
    async next(): Promise<SearchVideoItem | null> {
      while (!queue.length && !noMore) {
        await pace();
        const res = await searchVideoPage(keyword, page + 1);
        page += 1;
        const inFolder = new Set(
          (useLocalFavItemsStore.getState().folderItems[folderId] ?? []).map(i => i.bvid).filter(Boolean),
        );
        queue.push(
          ...res.list.filter(
            v => v.bvid && !seen.has(v.bvid) && !inFolder.has(v.bvid) && isTrustedCandidate(keyword, duration, v),
          ),
        );
        if (page >= MAX_PAGES || page >= res.numPages) noMore = true;
      }
      const picked = queue.shift() ?? null;
      if (picked) seen.add(picked.bvid);
      return picked;
    },
  };
};

export const toFavItem = (c: SearchVideoItem): Omit<LocalFavItem, "fav_time"> => ({
  rid: c.aid,
  type: 2,
  source: "online",
  title: stripHtml(c.title),
  cover: formatUrlProtocol(c.pic),
  bvid: c.bvid,
  ownerName: c.author,
  ownerMid: c.mid,
  duration: parseDuration(c.duration),
  playCount: c.play,
});

const newLog = (original: LocalFavItem): ReplaceLog => ({
  id: String(original.rid),
  status: "pending",
  original,
  tried: [],
  time: Date.now(),
  mode: "auto",
});

export const getOrCreateLog = (folderId: number, item: LocalFavItem): ReplaceLog => {
  const logs = useLocalFavItemsStore.getState().replaceLogs?.[folderId] ?? [];
  return logs.find(l => l.id === String(item.rid) || String(l.current?.rid) === String(item.rid)) ?? newLog(item);
};

export const applyReplacement = (folderId: number, log: ReplaceLog, cand: SearchVideoItem, mode: "auto" | "manual") => {
  const { replaceItem, upsertReplaceLog } = useLocalFavItemsStore.getState();
  const fromRid = log.status === "replaced" && log.current ? log.current.rid : log.original.rid;
  const next = toFavItem(cand);
  replaceItem(folderId, fromRid, next);
  upsertReplaceLog(folderId, {
    ...log,
    status: "replaced",
    current: { rid: next.rid, bvid: next.bvid, title: next.title },
    tried: [...new Set([...log.tried, cand.bvid])],
    time: Date.now(),
    mode,
    reason: undefined,
  });
};

const restoreOriginal = (folderId: number, log: ReplaceLog) => {
  if (log.status !== "replaced" || !log.current) return;
  useLocalFavItemsStore.getState().replaceItem(folderId, log.current.rid, { ...log.original, invalid: true });
};

const toPending = (folderId: number, log: ReplaceLog, reason: string, tried: string[]) => {
  restoreOriginal(folderId, log);
  useLocalFavItemsStore.getState().upsertReplaceLog(folderId, {
    ...log,
    status: "pending",
    current: undefined,
    tried,
    time: Date.now(),
    reason,
  });
};

export const undoReplacement = (folderId: number, log: ReplaceLog) =>
  toPending(folderId, log, "已撤销，保持失效", log.tried);

export const removeInvalidItem = (folderId: number, log: ReplaceLog) => {
  const { removeItem, removeReplaceLog } = useLocalFavItemsStore.getState();
  removeItem(folderId, log.status === "replaced" && log.current ? log.current.rid : log.original.rid);
  removeReplaceLog(folderId, log.id);
};

/** 「换一个」/「重试」：候选耗尽时还原成失效项，交给用户自己搜索；搜索出错时抛出，由调用方展示原因 */
export const findAnother = async (folderId: number, log: ReplaceLog) => {
  const finder = createCandidateFinder(log.original, folderId, log.tried);
  if (log.current?.bvid) finder.seen.add(log.current.bvid);
  const cand = await finder.next();
  if (!cand) {
    toPending(folderId, log, "没有更多可信的候选，可以自己搜索", [...finder.seen]);
    return false;
  }
  applyReplacement(folderId, log, cand, "auto");
  return true;
};

/** 打开歌单时对新发现的失效视频各尝试一次；遇到搜索错误立即停手，不继续打接口 */
export const autoReplaceFolder = async (folderId: number) => {
  const state = useLocalFavItemsStore.getState();
  state.pruneReplaceLogs(folderId);
  const logged = new Set((useLocalFavItemsStore.getState().replaceLogs?.[folderId] ?? []).map(l => l.id));
  const targets = (useLocalFavItemsStore.getState().folderItems[folderId] ?? []).filter(
    i => i.invalid && i.type === 2 && i.source !== "local" && i.bvid && !logged.has(String(i.rid)),
  );

  for (const item of targets) {
    const log = newLog(item);
    try {
      const cand = await createCandidateFinder(item, folderId, []).next();
      if (cand) {
        applyReplacement(folderId, log, cand, "auto");
      } else {
        useLocalFavItemsStore.getState().upsertReplaceLog(folderId, { ...log, reason: "没有找到可信的同名视频" });
      }
    } catch (err) {
      useLocalFavItemsStore.getState().upsertReplaceLog(folderId, {
        ...log,
        status: "error",
        reason: err instanceof Error ? err.message : "搜索失败",
      });
      return;
    }
  }
};
