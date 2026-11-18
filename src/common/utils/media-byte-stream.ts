import { log } from "@/platform";

export class MediaFetchError extends Error {
  constructor(readonly status: number) {
    super(`media fetch failed: ${status}`);
  }
}

class InvalidMediaRange extends Error {}

const parseLength = (value: string | null) => {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : undefined;
};

const mediaValidator = (headers: Headers) => {
  const tag = headers.get("etag");
  return tag?.startsWith('"') ? tag : (headers.get("last-modified") ?? undefined);
};

function checkResponse(
  response: Response,
  offset: number,
  total: number | undefined,
  rangeRequested: boolean,
  validator?: string,
) {
  if (!response.ok || !response.body) throw new MediaFetchError(response.status);
  const encoding = response.headers.get("content-encoding");
  const identity = !encoding || encoding.toLowerCase() === "identity";
  const length = parseLength(response.headers.get("content-length"));
  const observedValidator = mediaValidator(response.headers);
  if (response.status === 206) {
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get("content-range") ?? "");
    const end = parseLength(match?.[2] ?? null);
    const size = parseLength(match?.[3] ?? null);
    if (
      !match ||
      !identity ||
      Number(match[1]) !== offset ||
      size === undefined ||
      size <= offset ||
      end !== size - 1 ||
      (length !== undefined && length !== size - offset) ||
      (total !== undefined && total !== size) ||
      (validator && observedValidator && observedValidator !== validator)
    ) {
      throw new InvalidMediaRange("续流位置或文件版本不匹配");
    }
    return { body: response.body, identity, total: size, validator: validator ?? observedValidator };
  }
  // Range 被忽略（或 If-Range 的文件版本已变）时，整文件绝不能拼在旧数据后面。
  if (rangeRequested || response.status !== 200) throw new InvalidMediaRange("播放源未返回请求的字节范围");
  return {
    body: response.body,
    identity,
    total: identity ? length : undefined,
    validator: identity ? observedValidator : undefined,
  };
}

const MAX_REPAIRS = 2;

export async function* streamMediaBytes(
  url: string,
  options: {
    start: number;
    total?: number;
    signal: AbortSignal;
    bufferSeconds: () => number | undefined;
  },
): AsyncGenerator<Uint8Array> {
  const { signal, bufferSeconds } = options;
  let offset = options.start;
  let total = options.total;
  let validator: string | undefined;
  let repairs = 0;
  let identity = true;
  let tail = new Uint8Array(0);
  const hasRepairBudget = () => !signal.aborted && repairs < MAX_REPAIRS && offset > options.start && identity;

  while (!signal.aborted) {
    const request = new AbortController();
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const headers: Record<string, string> = {};
      // 没有 ETag / 修改时间的源重读至多 32 字节，确认接缝匹配后只交付新的字节。
      // 编码传输的解码后位置不是 HTTP 偏移，因此不尝试续接。
      const overlap = repairs && !validator ? tail : new Uint8Array(0);
      let verified = 0;
      const from = offset - overlap.length;
      if (offset > 0) headers.Range = `bytes=${from}-`;
      if (repairs && validator) headers["If-Range"] = validator;
      // 首次取流沿用播放器的起播宽限。续流则已有可播放的缓冲，不无限等响应头。
      if (repairs) timer = setTimeout(abort, Math.max(1.5, Math.min(8, (bufferSeconds() ?? 0) - 2)) * 1000);
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "same-origin",
        headers,
        signal: request.signal,
      });
      clearTimeout(timer);
      const checked = checkResponse(response, from, total, offset > 0, validator);
      total = checked.total;
      identity = checked.identity;
      validator = checked.validator;
      reader = checked.body.getReader();
      for (;;) {
        if (signal.aborted) return;
        const seconds = hasRepairBudget() ? bufferSeconds() : undefined;
        if (seconds !== undefined) {
          // 仅对正在等下一块字节的 read 计时。主动暂停或因为缓冲已满而停止读，都不是断线。
          const wait = Math.max(1.5, Math.min(8, seconds - 4));
          timer = setTimeout(() => {
            if (bufferSeconds() === undefined) return;
            idle = true;
            abort();
          }, wait * 1000);
        }
        const { done, value } = await reader.read();
        clearTimeout(timer);
        if (signal.aborted) return;
        if (idle) throw new Error("媒体响应停止送数");
        if (done) {
          if (verified !== overlap.length) throw new InvalidMediaRange("续流接缝不完整");
          if (total !== undefined && offset !== total) throw new Error("音频响应提前结束");
          return;
        }
        const skip = Math.min(value.byteLength, overlap.length - verified);
        for (let i = 0; i < skip; i++) {
          if (value[i] !== overlap[verified + i]) throw new InvalidMediaRange("续流接缝的音频内容已变化");
        }
        verified += skip;
        const bytes = value.subarray(skip);
        if (!bytes.byteLength) continue;
        if (total !== undefined && offset + bytes.byteLength > total) throw new InvalidMediaRange("音频超出声明的范围");
        // 游标含调用方尚未凑够一次 append 的字节；修复请求不会重复或遗漏半个 MP4 分片。
        if (identity && !validator) {
          if (bytes.byteLength >= 32) tail = bytes.slice(-32);
          else {
            const suffix = tail.subarray(bytes.byteLength - 32);
            tail = new Uint8Array([...suffix, ...bytes]);
          }
        }
        offset += bytes.byteLength;
        yield bytes;
        if (offset === total) return;
      }
    } catch (error) {
      if (signal.aborted) return;
      if (
        error instanceof MediaFetchError ||
        error instanceof InvalidMediaRange ||
        !hasRepairBudget() ||
        bufferSeconds() === undefined
      ) {
        // 内部读超时不是用户切歌；外层须走正常兜底，而不是把 AbortError 当作取消。
        if (request.signal.aborted) throw new Error("续取音频数据超时");
        throw error;
      }
      repairs += 1;
      log.warn("[mse] 保留缓冲续取音频", { offset, attempt: repairs, bufferedSeconds: bufferSeconds(), idle });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      abort();
      reader?.releaseLock();
    }
    // 第一次立即续接；网络刚断开时第二次留出恢复时间，但不耗尽剩余缓冲。
    if (repairs === MAX_REPAIRS) {
      const ms = Math.min(2500, Math.max(0, ((bufferSeconds() ?? 0) - 2) * 1000));
      if (ms > 0 && !signal.aborted) {
        await new Promise<void>(resolve => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, ms);
          signal.addEventListener("abort", done, { once: true });
        });
      }
    }
    if (!signal.aborted && bufferSeconds() === undefined) throw new Error("暂停期间媒体连接已中断");
  }
}
