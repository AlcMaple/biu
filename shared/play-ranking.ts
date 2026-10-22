import SparkMD5 from "spark-md5";

export const PLAY_RANKING_LOCAL_KEY = "play-ranking-sync";
export const RANKING_RECENT_MS = 30 * 24 * 60 * 60 * 1000;
export const RANKING_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface RankingEvent {
  seq: number;
  record: PlayCountRecord;
}

export interface CloudRanking {
  mid: string;
  version: number;
  updatedAt: number;
  records: PlayCountsData;
  ackSeq?: number;
}

export interface RankingAccount {
  nextSeq: number;
  pending: RankingEvent[];
  cloud?: CloudRanking;
}

export interface RankingLocalState {
  schema: 1;
  deviceId: string;
  unassigned: PlayCountsData;
  accounts: Record<string, RankingAccount>;
}

export type RankingLocalAction =
  | { kind: "read" }
  | { kind: "record"; mid: string | null; record: PlayCountRecord }
  | { kind: "import"; mid: string }
  | { kind: "ack"; mid: string; snapshot: CloudRanking };

export function portableRankingRecord(record: PlayCountRecord, now: number): PlayCountRecord | undefined {
  if (!record || typeof record.key !== "string" || typeof record.title !== "string") return;
  if (!Number.isSafeInteger(record.totalCount) || record.totalCount <= 0) return;
  let key = record.key;
  if (key.startsWith("local:")) {
    // 本地文件只同步统计；旧 key 可能含绝对路径，云端只保留不可还原的身份摘要。
    key = /^local:[a-f0-9]{32}$/.test(key) ? key : `local:${SparkMD5.hash(key)}`;
  } else if (!/^online:(?:BV[a-zA-Z0-9]+|\d+):\d*$/.test(key)) return;
  let cover: string | undefined;
  try {
    const url = new URL(record.cover ?? "");
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048)
      cover = url.href;
  } catch {
    // file/data/blob 封面只属于原设备，不进入可跨设备读取的排行。
  }
  const recentPlays = (Array.isArray(record.recentPlays) ? record.recentPlays : [])
    .filter(t => Number.isSafeInteger(t) && t > now - RANKING_RECENT_MS && t <= now)
    .sort((a, b) => a - b);
  return {
    key,
    title: record.title.slice(0, 500),
    cover,
    ownerName: typeof record.ownerName === "string" ? record.ownerName.slice(0, 200) : undefined,
    ownerMid: Number.isSafeInteger(record.ownerMid) && record.ownerMid! > 0 ? record.ownerMid : undefined,
    bvid: /^BV[a-zA-Z0-9]+$/.test(record.bvid ?? "") ? record.bvid : undefined,
    isLossless: record.isLossless === true,
    isDolby: record.isDolby === true,
    totalCount: record.totalCount,
    recentPlays: recentPlays.slice(-record.totalCount),
  };
}

export function updateRankingLocal(
  stored: RankingLocalState | undefined,
  legacy: PlayCountsData | undefined,
  action: RankingLocalAction,
  now = Date.now(),
): RankingLocalState {
  if (stored && stored.schema !== 1) throw new Error("听歌记录格式不受支持，原数据已保留");
  const state: RankingLocalState = stored
    ? structuredClone(stored)
    : { schema: 1, deviceId: crypto.randomUUID(), unassigned: structuredClone(legacy ?? {}), accounts: {} };
  if (action.kind === "read") return state;
  if (action.mid !== null && !/^\d+$/.test(action.mid)) throw new Error("听歌记录账号无效");
  const mid = action.mid;
  const account = mid ? (state.accounts[mid] ??= { nextSeq: 1, pending: [] }) : undefined;
  if (action.kind === "record") {
    const record = portableRankingRecord(action.record, now);
    if (!record) throw new Error("听歌记录内容无效");
    if (account) {
      account.pending.push({ seq: account.nextSeq++, record });
    } else {
      const previous = state.unassigned[record.key];
      state.unassigned[record.key] = {
        ...record,
        totalCount: (previous?.totalCount ?? 0) + record.totalCount,
        recentPlays: [...(previous?.recentPlays ?? []), ...record.recentPlays].filter(t => t > now - RANKING_RECENT_MS),
      };
    }
  } else if (action.kind === "import" && account) {
    for (const [key, original] of Object.entries(state.unassigned)) {
      const record = portableRankingRecord(original, now);
      if (!record) continue;
      // 长期未登录也可能积累很多明细；拆分只影响传输，不能截断周排行或重复累计历史总数。
      for (let offset = 0; offset < Math.max(1, record.recentPlays.length); offset += 10000) {
        const times = record.recentPlays.slice(offset, offset + 10000);
        const totalCount =
          offset === 0 ? record.totalCount - Math.max(0, record.recentPlays.length - 10000) : times.length;
        account.pending.push({ seq: account.nextSeq++, record: { ...record, totalCount, recentPlays: times } });
      }
      delete state.unassigned[key];
    }
  } else if (action.kind === "ack" && account) {
    const snapshot = action.snapshot;
    if (snapshot.mid !== mid) throw new Error("账号已变化，已保留原账号待同步记录");
    if (snapshot.ackSeq !== undefined) {
      if (!Number.isSafeInteger(snapshot.ackSeq) || snapshot.ackSeq < 0 || snapshot.ackSeq >= account.nextSeq) {
        throw new Error("云端确认序号异常，待同步记录已保留");
      }
      account.pending = account.pending.filter(event => event.seq > snapshot.ackSeq!);
    }
    if (!account.cloud || snapshot.version >= account.cloud.version) account.cloud = snapshot;
  }
  return state;
}

export function nextRankingBatch(events: RankingEvent[]): RankingEvent[] {
  const batch: RankingEvent[] = [];
  let bytes = 256;
  for (const event of events.slice(0, 100)) {
    const size = new TextEncoder().encode(JSON.stringify(event)).byteLength + 1;
    if (bytes + size > 1_000_000) {
      if (!batch.length) throw new Error("单条听歌记录过大，原记录已保留");
      break;
    }
    batch.push(event);
    bytes += size;
  }
  return batch;
}
