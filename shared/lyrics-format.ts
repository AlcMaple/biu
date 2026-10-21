// 外部歌词渠道（QQ LRC / 酷狗 KRC / AMLL TTML）规范化成同一份毫秒时间轴。
// 纯文本处理，不依赖 Node / DOM：主进程、Web BFF、渲染层和测试共用。
// 这里的时间是平台给的原唱时间轴，不代表已经对齐到当前 B 站录音（那是声学对齐的结果，另存）。

export type LyricsProvider = "qq" | "kugou" | "amll";

export type LyricsSourceFormat = "lrc" | "krc" | "ttml";

export interface NormalizedLyricWord {
  startMs: number;
  endMs: number;
  text: string;
}

export interface NormalizedLyricVocal {
  text: string;
  words?: NormalizedLyricWord[];
  translation?: string;
  romanization?: string;
}

export interface NormalizedLyricLine extends NormalizedLyricVocal {
  startMs: number;
  /** 平台原生给出的行结束；LRC 没有，用下一行开始补，标在 endInferred */
  endMs: number;
  endInferred?: true;
  /** TTML 的演唱者（对唱 / 合唱），原样保留 */
  agent?: string;
  /** 和声 / 背景人声，与主唱同一行时间内另起一轨 */
  background?: NormalizedLyricVocal;
}

export interface NormalizedLyrics {
  format: LyricsSourceFormat;
  /** word = 至少有一行带逐字时间 */
  timing: "line" | "word";
  lines: NormalizedLyricLine[];
}

export class LyricsFormatError extends Error {
  constructor(
    message: string,
    readonly unsupported = false,
  ) {
    super(message);
    this.name = "LyricsFormatError";
  }
}

const MAX_LYRICS_CHARS = 1_000_000;
// LRC 末行没有下一行可以借结束时间，给个保守时长，避免末句高亮无限延长
const LAST_LINE_FALLBACK_MS = 5_000;

function assertSize(raw: string) {
  if (raw.length > MAX_LYRICS_CHARS) throw new LyricsFormatError("歌词内容过大");
}

function finalize(format: LyricsSourceFormat, lines: NormalizedLyricLine[]): NormalizedLyrics {
  const sorted = lines.toSorted((a, b) => a.startMs - b.startMs);
  return {
    format,
    timing: sorted.some(line => line.words?.length) ? "word" : "line",
    lines: sorted,
  };
}

// ---------- LRC ----------

const LRC_STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

interface LrcEntry {
  startMs: number;
  text: string;
}

function readLrcEntries(raw: string): LrcEntry[] {
  const entries: LrcEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    LRC_STAMP.lastIndex = 0;
    while ((match = LRC_STAMP.exec(line)) !== null) {
      const fraction = match[3] ? Number(match[3].padEnd(3, "0")) : 0;
      stamps.push(Number(match[1]) * 60_000 + Number(match[2]) * 1000 + fraction);
    }
    if (!stamps.length) continue;
    const text = line.replace(LRC_STAMP, "").trim();
    for (const startMs of stamps) entries.push({ startMs, text });
  }
  return entries.toSorted((a, b) => a.startMs - b.startMs);
}

// 空文本行（间奏标记）不单独成行，但用作上一行的结束时间
export function parseLrcText(raw: string, translationRaw?: string): NormalizedLyrics {
  assertSize(raw);
  const entries = readLrcEntries(raw);
  if (!entries.some(entry => entry.text)) throw new LyricsFormatError("歌词没有带时间的行");

  const translations = new Map<number, string>();
  if (translationRaw) {
    assertSize(translationRaw);
    for (const entry of readLrcEntries(translationRaw)) {
      // QQ 译文用「//」占位表示该行无译文
      if (entry.text && entry.text !== "//") translations.set(entry.startMs, entry.text);
    }
  }

  const lines: NormalizedLyricLine[] = [];
  entries.forEach((entry, index) => {
    if (!entry.text) return;
    const next = entries.slice(index + 1).find(item => item.startMs > entry.startMs);
    const line: NormalizedLyricLine = {
      startMs: entry.startMs,
      endMs: next ? next.startMs : entry.startMs + LAST_LINE_FALLBACK_MS,
      endInferred: true,
      text: entry.text,
    };
    const translation = translations.get(entry.startMs);
    if (translation) line.translation = translation;
    lines.push(line);
  });
  return finalize("lrc", lines);
}

// ---------- KRC（已解密解压后的文本） ----------

const KRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
const KRC_WORD = /<(\d+),(\d+),\d+>([^<]*)/g;

interface KrcLanguageBlock {
  type?: number;
  lyricContent?: string[][];
}

function decodeBase64Utf8(value: string) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// [language:] 是 base64 JSON：type 1 = 译文，type 0 = 罗马音；按行序与带时间的行一一对应
function readKrcLanguage(raw: string) {
  const match = /^\[language:([A-Za-z0-9+/=]*)\]\s*$/m.exec(raw);
  if (!match?.[1]) return {};
  let blocks: KrcLanguageBlock[] | undefined;
  try {
    blocks = (JSON.parse(decodeBase64Utf8(match[1])) as { content?: KrcLanguageBlock[] }).content;
  } catch {
    throw new LyricsFormatError("酷狗歌词的译文段无法解析");
  }
  const pick = (type: number) =>
    blocks?.find(block => block.type === type)?.lyricContent?.map(cells => cells.join("").trim());
  return { translation: pick(1), romanization: pick(0) };
}

export function parseKrcText(raw: string): NormalizedLyrics {
  assertSize(raw);
  const { translation, romanization } = readKrcLanguage(raw);
  const lines: NormalizedLyricLine[] = [];
  let timedIndex = 0;

  for (const row of raw.split(/\r?\n/)) {
    const match = KRC_LINE.exec(row.trim());
    if (!match) continue;
    const startMs = Number(match[1]);
    const endMs = startMs + Number(match[2]);
    const words: NormalizedLyricWord[] = [];
    KRC_WORD.lastIndex = 0;
    let word: RegExpExecArray | null;
    // 字时间是相对行首的偏移，单位毫秒
    while ((word = KRC_WORD.exec(match[3])) !== null) {
      if (!word[3]) continue;
      const wordStart = startMs + Number(word[1]);
      words.push({ startMs: wordStart, endMs: wordStart + Number(word[2]), text: word[3] });
    }
    const text = (words.length ? words.map(item => item.text).join("") : match[3]).trim();
    const index = timedIndex++;
    if (!text) continue;

    const line: NormalizedLyricLine = { startMs, endMs, text };
    if (words.length) line.words = words;
    if (translation?.[index]) line.translation = translation[index];
    if (romanization?.[index]) line.romanization = romanization[index];
    lines.push(line);
  }

  if (!lines.length) throw new LyricsFormatError("酷狗歌词没有带时间的行");
  return finalize("krc", lines);
}

// ---------- TTML ----------

interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

type XmlNode = XmlElement | string;

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)));
    const named = XML_ENTITIES[body];
    if (named === undefined) throw new LyricsFormatError("TTML 含未定义的实体");
    return named;
  });
}

function localName(name: string) {
  const index = name.indexOf(":");
  return index === -1 ? name : name.slice(index + 1);
}

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

// 只覆盖 TTML 歌词用到的 XML 子集；DTD / 实体声明一律拒绝，免得实体膨胀
function parseXml(raw: string): XmlElement {
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new LyricsFormatError("TTML 不允许 DTD");
  const root: XmlElement = { name: "#root", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([^\s/>]+)([^>]*?)(\/?)>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const appendText = (text: string) => {
    if (text) stack.at(-1)!.children.push(text);
  };

  while ((match = tag.exec(raw)) !== null) {
    appendText(decodeEntities(raw.slice(cursor, match.index)));
    cursor = tag.lastIndex;
    if (match[0].startsWith("<!--") || match[0].startsWith("<?")) continue;
    if (match[1] !== undefined) {
      appendText(match[1]);
      continue;
    }
    const [, , closing, name, attrText, selfClosing] = match;
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name || stack.length === 0) throw new LyricsFormatError("TTML 标签不匹配");
      continue;
    }
    const attrs: Record<string, string> = {};
    ATTR.lastIndex = 0;
    let attr: RegExpExecArray | null;
    while ((attr = ATTR.exec(attrText)) !== null) {
      attrs[attr[1]] = decodeEntities(attr[3] ?? attr[4] ?? "");
    }
    const element: XmlElement = { name, attrs, children: [] };
    stack.at(-1)!.children.push(element);
    if (!selfClosing) stack.push(element);
  }
  if (stack.length !== 1 || raw.slice(cursor).trim()) throw new LyricsFormatError("TTML 结构不完整");

  const top = root.children.filter((node): node is XmlElement => typeof node !== "string");
  if (top.length !== 1 || localName(top[0].name) !== "tt") throw new LyricsFormatError("不是 TTML 文档");
  return top[0];
}

function attr(element: XmlElement, name: string) {
  for (const [key, value] of Object.entries(element.attrs)) {
    if (localName(key) === name) return value;
  }
  return undefined;
}

// TTML 时钟值：hh:mm:ss(.fff) / mm:ss(.fff) / 纯秒，或带 h/m/s/ms 单位的偏移值
export function parseTtmlTime(value: string): number {
  const text = value.trim();
  const offset = /^(\d+(?:\.\d+)?)(h|m|s|ms)$/.exec(text);
  if (offset) {
    const scale = { h: 3_600_000, m: 60_000, s: 1000, ms: 1 }[offset[2] as "h" | "m" | "s" | "ms"];
    return Math.round(Number(offset[1]) * scale);
  }
  const clock = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(text);
  if (!clock) throw new LyricsFormatError(`TTML 时间格式不支持：${text}`, true);
  const parts = [clock[1], clock[2]].filter((part): part is string => part !== undefined).map(Number);
  const [hours, minutes] = parts.length === 2 ? parts : [0, parts[0] ?? 0];
  return Math.round(hours * 3_600_000 + minutes * 60_000 + Number(clock[3]) * 1000);
}

function textOf(node: XmlNode): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

function readVocal(container: XmlElement): NormalizedLyricVocal & { background?: NormalizedLyricVocal } {
  const words: NormalizedLyricWord[] = [];
  const plain: string[] = [];
  const result: NormalizedLyricVocal & { background?: NormalizedLyricVocal } = { text: "" };

  for (const child of container.children) {
    if (typeof child === "string") {
      // 词与词之间的空格是文本节点（英文歌词），挂到上一个词尾，换行缩进只算一个空格
      const space = child.replace(/\s+/g, " ");
      if (words.length && space) words.at(-1)!.text += space;
      else plain.push(space);
      continue;
    }
    if (localName(child.name) !== "span") continue;
    const role = attr(child, "role");
    if (role === "x-translation") {
      result.translation = textOf(child).trim();
      continue;
    }
    if (role === "x-roman") {
      result.romanization = textOf(child).trim();
      continue;
    }
    if (role === "x-bg") {
      const background = readVocal(child);
      if (background.text) result.background = background;
      continue;
    }
    const begin = attr(child, "begin");
    const end = attr(child, "end");
    const text = textOf(child);
    if (begin !== undefined && end !== undefined) {
      words.push({ startMs: parseTtmlTime(begin), endMs: parseTtmlTime(end), text });
    } else {
      plain.push(text);
    }
  }

  if (words.length && plain.join("").trim()) {
    throw new LyricsFormatError("TTML 同一行混用了带时间和不带时间的文本", true);
  }
  if (words.length) {
    result.words = words;
    result.text = words
      .map(word => word.text)
      .join("")
      .trim();
    for (const word of words) word.text = word.text.replace(/\s+$/, " ");
    words.at(-1)!.text = words.at(-1)!.text.trimEnd();
  } else {
    result.text = plain.join("").trim();
  }
  return result;
}

function collect(element: XmlElement, name: string, out: XmlElement[] = []) {
  for (const child of element.children) {
    if (typeof child === "string") continue;
    if (localName(child.name) === name) out.push(child);
    else collect(child, name, out);
  }
  return out;
}

export function parseTtmlText(raw: string): NormalizedLyrics {
  assertSize(raw);
  const tt = parseXml(raw);
  // AMLL 的 begin/end 都是相对整首歌的绝对时间；标准 TTML 允许 seq 容器或非 media 时基，
  // 那样子元素时间要按父级累加，这里没实现，与其悄悄错位不如直接拒绝
  const timeBase = attr(tt, "timeBase");
  if (timeBase && timeBase !== "media") throw new LyricsFormatError("TTML 时基不支持", true);
  if (raw.includes('timeContainer="seq"')) throw new LyricsFormatError("TTML 顺序时间容器不支持", true);

  const body = collect(tt, "body")[0];
  if (!body) throw new LyricsFormatError("TTML 缺少 body");

  const lines: NormalizedLyricLine[] = [];
  for (const p of collect(body, "p")) {
    const vocal = readVocal(p);
    if (!vocal.text) continue;
    const begin = attr(p, "begin");
    const end = attr(p, "end");
    const startMs = begin !== undefined ? parseTtmlTime(begin) : vocal.words?.[0]?.startMs;
    const endMs = end !== undefined ? parseTtmlTime(end) : vocal.words?.at(-1)?.endMs;
    if (startMs === undefined || endMs === undefined) throw new LyricsFormatError("TTML 歌词行缺少时间", true);

    const line: NormalizedLyricLine = { ...vocal, startMs, endMs };
    const agent = attr(p, "agent");
    if (agent) line.agent = agent;
    lines.push(line);
  }

  if (!lines.length) throw new LyricsFormatError("TTML 没有歌词行");
  return finalize("ttml", lines);
}

// ---------- 输出给现有行级 LRC 消费方 ----------

function formatStamp(ms: number) {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}]`;
}

export function toLrc(lyrics: NormalizedLyrics, field: "text" | "translation" = "text"): string {
  return lyrics.lines
    .filter(line => line[field])
    .map(line => `${formatStamp(line.startMs)}${line[field]}`)
    .join("\n");
}
