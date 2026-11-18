import { log } from "@/platform";

export class MediaFetchError extends Error {
  constructor(readonly status: number) {
    super(`media fetch failed: ${status}`);
  }
}

class InvalidMediaRange extends Error {}

type Comparison = string | number;
export class MediaHeaderMismatch extends InvalidMediaRange {
  constructor(
    readonly details: {
      reason: string;
      field: string;
      expected: Comparison;
      actual: Comparison;
      status: number;
      requestedStart: number;
      expectedTotal: number | null;
      returnedStart: number | null;
      returnedEnd: number | null;
      returnedTotal: number | null;
      contentLength: number | null;
    },
  ) {
    super(`${details.field}: expected ${details.expected}, got ${details.actual} [${details.reason}]`);
  }
}

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
  if (!response.ok) throw new MediaFetchError(response.status);
  if (!response.body) throw new InvalidMediaRange(`HTTP ${response.status}: missing response body`);
  const encoding = response.headers.get("content-encoding")?.toLowerCase();
  const identity = !encoding || encoding === "identity";
  const rawLength = response.headers.get("content-length");
  const length = parseLength(rawLength);
  const rawRange = response.headers.get("content-range");
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(rawRange ?? "");
  const start = parseLength(match?.[1] ?? null);
  const end = parseLength(match?.[2] ?? null);
  const size = parseLength(match?.[3] ?? null);
  const observedValidator = mediaValidator(response.headers);
  // 白名单中的数字和分类足以重放判断；原始 ETag、异常头文本和签名 URL 不进日志。
  const mismatch = (reason: string, field: string, expected: Comparison, actual: Comparison) =>
    new MediaHeaderMismatch({
      reason,
      field,
      expected,
      actual,
      status: response.status,
      requestedStart: offset,
      expectedTotal: total ?? null,
      returnedStart: start ?? null,
      returnedEnd: end ?? null,
      returnedTotal: size ?? null,
      contentLength: length ?? null,
    });

  if (response.status === 206) {
    if (rawRange === null) throw mismatch("missing-range", "Content-Range", "bytes start-end/total", "missing");
    if (!match)
      throw mismatch(
        "malformed-range",
        "Content-Range",
        "bytes start-end/total",
        /^bytes \d+-\d+\/\*$/i.test(rawRange) ? "unknown total (*)" : "invalid syntax",
      );
    if (!identity)
      throw mismatch(
        "encoded-range",
        "Content-Encoding",
        "identity",
        ["gzip", "br", "zstd", "deflate"].includes(encoding!) ? encoding! : "other encoding",
      );
    if (start !== offset) throw mismatch("wrong-start", "Content-Range.start", offset, start ?? "not a safe integer");
    if (size === undefined || size <= offset)
      throw mismatch("invalid-total", "Content-Range.total", `> ${offset}`, size ?? "not a safe integer");
    if (end === undefined || end < offset || end >= size)
      throw mismatch("invalid-end", "Content-Range.end", `${offset}..${size - 1}`, end ?? "not a safe integer");
    if (total !== undefined && total !== size) throw mismatch("changed-total", "Content-Range.total", total, size);
    const partLength = end - offset + 1;
    if (rawLength !== null && length === undefined)
      throw mismatch("invalid-length", "Content-Length", partLength, "not a non-negative safe integer");
    if (length !== undefined && length !== partLength)
      throw mismatch("wrong-length", "Content-Length", partLength, length);
    if (validator) {
      // If-Range 发的是日期就比日期。续段额外带了强 ETag 并不代表文件变了。
      const field = validator.startsWith('"') ? "ETag" : "Last-Modified";
      const comparable = response.headers.get(field);
      if (comparable !== null && comparable !== validator) {
        throw mismatch("changed-validator", field, `unchanged ${field}`, `changed ${field}`);
      }
      if (comparable === null && observedValidator) {
        throw mismatch(
          "missing-validator",
          field,
          `unchanged ${field}`,
          observedValidator.startsWith('"') ? "only ETag returned" : "only Last-Modified returned",
        );
      }
    }
    return {
      body: response.body,
      identity,
      total: size,
      endExclusive: end + 1,
      validator: validator ?? observedValidator,
    };
  }
  if (rangeRequested) throw mismatch("range-ignored", "HTTP.status", 206, response.status);
  if (response.status !== 200) throw mismatch("unexpected-status", "HTTP.status", 200, response.status);
  return {
    body: response.body,
    identity,
    total: identity ? length : undefined,
    endExclusive: identity ? length : undefined,
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
  let shortParts = 0;
  let previousPartWasTiny = false;
  let identity = true;
  let tail = new Uint8Array(0);
  const hasRepairBudget = () => !signal.aborted && repairs < MAX_REPAIRS && offset > options.start && identity;

  responses: while (!signal.aborted) {
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
      const continuation = repairs > 0 || shortParts > 0;
      const overlap = continuation && !validator ? tail : new Uint8Array(0);
      let verified = 0;
      const previousOffset = offset;
      const from = offset - overlap.length;
      if (offset > 0) headers.Range = `bytes=${from}-`;
      if (continuation && validator) headers["If-Range"] = validator;
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
          if (checked.endExclusive !== undefined && offset !== checked.endExclusive) {
            throw new Error(`音频响应提前结束：预期下一字节 ${checked.endExclusive}，实际 ${offset}`);
          }
          if (total === undefined || offset === total) return;
          // 206 可以只覆盖剩余文件的一段；只有整段已验收、且净游标前进，才取下一段。
          // 限制微小分段以及总次数，异常源不能靠持续返回几个字节制造请求风暴。
          const advanced = offset - previousOffset;
          if (advanced <= 0) throw new InvalidMediaRange(`Content-Range.end: no new bytes after overlap at ${offset}`);
          if ((previousPartWasTiny && advanced < 16384) || ++shortParts > 32) {
            throw new InvalidMediaRange(
              `Content-Range: excessive partial responses at ${offset}, last advance ${advanced}`,
            );
          }
          previousPartWasTiny = advanced < 16384;
          if (shortParts === 1) log.warn("[mse] 已验证短分段，继续取下一段", { from, nextOffset: offset, total });
          continue responses;
        }
        const skip = Math.min(value.byteLength, overlap.length - verified);
        for (let i = 0; i < skip; i++) {
          if (value[i] !== overlap[verified + i]) throw new InvalidMediaRange("续流接缝的音频内容已变化");
        }
        verified += skip;
        const bytes = value.subarray(skip);
        if (!bytes.byteLength) continue;
        if (checked.endExclusive !== undefined && offset + bytes.byteLength > checked.endExclusive) {
          throw new InvalidMediaRange(
            `响应正文超出声明范围：预期末端 ${checked.endExclusive}（不含），实际至少 ${offset + bytes.byteLength}`,
          );
        }
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
