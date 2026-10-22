import type { Envelope } from "./storage.js";

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

interface RankingRecord {
  key: string;
  title: string;
  cover?: string;
  ownerName?: string;
  ownerMid?: number;
  bvid?: string;
  isLossless?: boolean;
  isDolby?: boolean;
  totalCount: number;
  recentPlays: number[];
}

interface RankingEvent {
  seq: number;
  record: RankingRecord;
}

interface RankingData {
  records: Record<string, RankingRecord>;
  sequences: Record<string, number>;
}

export class RankingRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RankingRequestError("记录格式无效");
  return value as Record<string, unknown>;
}

function readRecord(value: unknown, now: number): RankingRecord {
  const item = object(value);
  if (typeof item.key !== "string" || !/^(?:online:(?:BV[a-zA-Z0-9]+|\d+):\d*|local:[a-f0-9]{32})$/.test(item.key)) {
    throw new RankingRequestError("歌曲标识无效");
  }
  if (typeof item.title !== "string" || item.title.length > 500) throw new RankingRequestError("歌曲名称无效");
  if (!Number.isSafeInteger(item.totalCount) || Number(item.totalCount) < 1) {
    throw new RankingRequestError("播放次数无效");
  }
  if (
    !Array.isArray(item.recentPlays) ||
    item.recentPlays.length > 10000 ||
    item.recentPlays.length > Number(item.totalCount)
  ) {
    throw new RankingRequestError("播放时间明细无效");
  }
  if (!item.recentPlays.every(t => Number.isSafeInteger(t) && t > 0 && t <= now + 300000)) {
    throw new RankingRequestError("播放时间无效，请检查设备时间");
  }
  let cover: string | undefined;
  if (item.cover !== undefined) {
    if (typeof item.cover !== "string" || item.cover.length > 2048) throw new RankingRequestError("封面地址无效");
    let url: URL;
    try {
      url = new URL(item.cover);
    } catch {
      throw new RankingRequestError("封面地址无效");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new RankingRequestError("封面只接受公共网页地址");
    cover = url.href;
  }
  return {
    key: item.key,
    title: item.title,
    cover,
    ownerName: typeof item.ownerName === "string" ? item.ownerName.slice(0, 200) : undefined,
    ownerMid: Number.isSafeInteger(item.ownerMid) && Number(item.ownerMid) > 0 ? Number(item.ownerMid) : undefined,
    bvid: /^online:BV/.test(item.key) ? item.key.split(":")[1] : undefined,
    isLossless: item.isLossless === true,
    isDolby: item.isDolby === true,
    totalCount: Number(item.totalCount),
    recentPlays: (item.recentPlays as number[]).filter(t => t > now - RECENT_MS),
  };
}

export function parseRankingBatch(body: unknown, mid: string, now: number) {
  const value = object(body);
  if (value.expectedMid !== mid) throw new RankingRequestError("账号已变化，请重新打开听歌排行", 409);
  if (typeof value.deviceId !== "string" || !/^[a-f0-9-]{36}$/.test(value.deviceId))
    throw new RankingRequestError("设备标识无效");
  if (!Array.isArray(value.events) || value.events.length < 1 || value.events.length > 100)
    throw new RankingRequestError("每批需要 1 至 100 条记录");
  const events: RankingEvent[] = value.events.map(raw => {
    const event = object(raw);
    if (!Number.isSafeInteger(event.seq) || Number(event.seq) < 1) throw new RankingRequestError("记录序号无效");
    return { seq: Number(event.seq), record: readRecord(event.record, now) };
  });
  for (let i = 1; i < events.length; i++) {
    if (events[i].seq !== events[i - 1].seq + 1) throw new RankingRequestError("记录序号应连续递增");
  }
  return { deviceId: value.deviceId, events };
}

function rankingData(envelope: Envelope): RankingData {
  const entry = envelope.data.ranking;
  if (!entry) return { records: {}, sequences: {} };
  if (entry.__deleted) throw new Error("排行存储出现异常删除标记");
  const value = entry.payload as RankingData;
  if (!value?.records || !value.sequences) throw new Error("排行存储格式异常");
  return value;
}

export function mergeRankingBatch(
  envelope: Envelope,
  batch: ReturnType<typeof parseRankingBatch>,
  now: number,
): Envelope {
  const data = structuredClone(rankingData(envelope));
  let sequence = data.sequences[batch.deviceId] ?? 0;
  let changed = false;
  for (const event of batch.events) {
    // 已落盘但响应丢失的批次重发时，只确认原序号，不再次累加。
    if (event.seq <= sequence) continue;
    if (event.seq !== sequence + 1) throw new RankingRequestError("待同步记录存在序号缺口，原记录已保留", 409);
    const previous = data.records[event.record.key];
    const count = (previous?.totalCount ?? 0) + event.record.totalCount;
    if (!Number.isSafeInteger(count)) throw new RankingRequestError("累计次数超出支持范围");
    data.records[event.record.key] = {
      ...previous,
      ...event.record,
      cover: event.record.cover ?? previous?.cover,
      ownerName: event.record.ownerName ?? previous?.ownerName,
      ownerMid: event.record.ownerMid ?? previous?.ownerMid,
      totalCount: count,
      recentPlays: [...(previous?.recentPlays ?? []), ...event.record.recentPlays]
        .filter(t => t > now - RECENT_MS)
        .sort((a, b) => a - b),
    };
    sequence = event.seq;
    changed = true;
  }
  if (!changed) return envelope;
  data.sequences[batch.deviceId] = sequence;
  return { version: envelope.version + 1, updatedAt: now, data: { ranking: { updatedAt: now, payload: data } } };
}

export function rankingSnapshot(envelope: Envelope, mid: string, deviceId?: string, now = Date.now()) {
  const data = rankingData(envelope);
  return {
    mid,
    version: envelope.version,
    updatedAt: envelope.updatedAt,
    records: Object.fromEntries(
      Object.entries(data.records).map(([key, record]) => [
        key,
        { ...record, recentPlays: record.recentPlays.filter(t => t > now - RECENT_MS) },
      ]),
    ),
    ...(deviceId ? { ackSeq: data.sequences[deviceId] ?? 0 } : {}),
  };
}
