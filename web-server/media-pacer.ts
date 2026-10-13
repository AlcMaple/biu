import { Transform, type TransformCallback } from "node:stream";

// 部署机公网带宽是硬上限（实测约 3.4 Mbps ≈ 425 KB/s），且同一条 HTTP/2 连接里音频和接口共用。
// 浏览器拉音频是「能多快就多快」，一首歌的前几十秒会把上限吃满，排在后面的收藏夹 JSON 就等到 10s 超时；
// 弱网下缓冲还会被抢断。所以：先放一段突发让起播和拖动够快，之后按「码率 × 倍数」匀速发，
// 余量留给接口。为什么不直接降音质：音质由账号权限决定，带宽问题应在带宽层解决。
const BURST_SECONDS = 15;
const SPEED_FACTOR = 2;
// 上限压不住 Hi-Res 这类高码率时，至少保留 1.25 倍实时速度，宁可挤占接口也不能让播放断粮
const MIN_REALTIME_FACTOR = 1.25;
const MIN_RATE_BYTES = 48 * 1024;

export function resolveMediaRate(bandwidthBitsPerSecond: number | undefined, maxRateBytes: number) {
  // 不知道码率（音乐区 cdns 不带）时不猜，直接用上限，避免把 FLAC 限到实时以下
  if (!bandwidthBitsPerSecond || bandwidthBitsPerSecond <= 0) return Math.max(maxRateBytes, MIN_RATE_BYTES);
  const bytesPerSecond = bandwidthBitsPerSecond / 8;
  const capped = Math.min(bytesPerSecond * SPEED_FACTOR, maxRateBytes);
  return Math.round(Math.max(capped, bytesPerSecond * MIN_REALTIME_FACTOR, MIN_RATE_BYTES));
}

export function createMediaPacer(rateBytesPerSecond: number, now: () => number = Date.now) {
  const burstBytes = rateBytesPerSecond * BURST_SECONDS;
  const startedAt = now();
  let sent = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      sent += chunk.length;
      const allowedAt = startedAt + ((sent - burstBytes) / rateBytesPerSecond) * 1000;
      const wait = allowedAt - now();
      if (wait <= 0) {
        callback(null, chunk);
        return;
      }
      setTimeout(() => callback(null, chunk), wait);
    },
  });
}
