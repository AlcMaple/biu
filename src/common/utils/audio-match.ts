/**
 * 听歌识曲音频链路（Web / Electron 共用）：
 * 麦克风或系统音频 → 原始 PCM 环形缓存 → 重采样到 8 kHz → afp.wasm 指纹 → 网易云曲库匹配。
 *
 * afp.js / afp.wasm.js 来自网易云官方 Chrome 扩展（经 NeteaseCloudMusicApiEnhanced 整理），
 * 放在 public/afp 下按需注入，避免 300KB 的 base64 WASM 进入主包。
 */

declare global {
  interface Window {
    GenerateFP?: (pcm: Float32Array) => Promise<string>;
  }
}

/** 网易云指纹要求的采样率 */
export const AFP_SAMPLE_RATE = 8000;

let afpLoading: Promise<NonNullable<Window["GenerateFP"]>> | null = null;

function injectScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`识曲组件加载失败：${src}`));
    document.head.appendChild(el);
  });
}

/** 按需加载 afp 指纹运行时（只加载一次，失败后允许重试） */
export function loadAfp() {
  if (window.GenerateFP) return Promise.resolve(window.GenerateFP);
  afpLoading ??= Promise.all([
    injectScript(new URL("afp/afp.wasm.js", document.baseURI).href),
    injectScript(new URL("afp/afp.js", document.baseURI).href),
  ])
    .then(() => {
      if (!window.GenerateFP) throw new Error("识曲组件初始化失败");
      return window.GenerateFP;
    })
    .catch(err => {
      afpLoading = null;
      throw err;
    });
  return afpLoading;
}

/** 生成网易云音频指纹（输入必须是 8 kHz 单声道 PCM） */
export async function generateAudioFP(pcm8k: Float32Array) {
  const generate = await loadAfp();
  return generate(pcm8k);
}

/** 用 OfflineAudioContext 重采样（自带抗混叠，比线性插值更接近网易云客户端的输入） */
export async function resample(pcm: Float32Array, fromRate: number, toRate: number) {
  if (fromRate === toRate) return pcm;
  const length = Math.max(1, Math.round((pcm.length * toRate) / fromRate));
  const ctx = new OfflineAudioContext(1, length, toRate);
  const buffer = ctx.createBuffer(1, pcm.length, fromRate);
  buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

/** 编码 16-bit PCM WAV（桌面端 Shazam 兜底使用） */
export function encodeWav(pcm: Float32Array, sampleRate: number) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buf);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/**
 * 从 MediaStream 持续采集单声道 PCM。
 * 用 ScriptProcessorNode 而非 AudioWorklet：iOS Safari / 旧 WebView 都可用，且无需额外模块文件。
 * AudioContext 必须在用户手势里同步创建，否则 iOS 会保持 suspended。
 */
export class PcmRecorder {
  readonly ctx: AudioContext;
  private chunks: Float32Array[] = [];
  private total = 0;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  /** 最近一段的峰值，用于提示"声音太小" */
  peak = 0;

  constructor() {
    const Ctor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    void this.ctx.resume().catch(() => {});
  }

  get sampleRate() {
    return this.ctx.sampleRate;
  }

  /** 已采集秒数 */
  get seconds() {
    return this.total / this.ctx.sampleRate;
  }

  async start(stream: MediaStream) {
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
    this.source = this.ctx.createMediaStreamSource(stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = e => {
      const data = e.inputBuffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
      this.peak = peak;
      this.chunks.push(new Float32Array(data));
      this.total += data.length;
    };
    // ScriptProcessor 必须连到 destination 才会被驱动；用 0 增益避免把麦克风声音外放形成回授
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(this.sink);
    this.sink.connect(this.ctx.destination);
  }

  /** 取最近 seconds 秒的原始 PCM（采样率为 ctx.sampleRate） */
  tail(seconds: number) {
    const want = Math.min(this.total, Math.round(seconds * this.ctx.sampleRate));
    const out = new Float32Array(want);
    let offset = want;
    for (let i = this.chunks.length - 1; i >= 0 && offset > 0; i--) {
      const chunk = this.chunks[i];
      const take = Math.min(chunk.length, offset);
      out.set(chunk.subarray(chunk.length - take), offset - take);
      offset -= take;
    }
    return out;
  }

  stop() {
    if (this.processor) this.processor.onaudioprocess = null;
    try {
      this.source?.disconnect();
      this.processor?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* ignore */
    }
    void this.ctx.close().catch(() => {});
  }
}

/** 把 LRC 转成纯文本行（识曲结果只用于人工核对，不做时间轴同步） */
export function lrcToLines(lrc: string) {
  return lrc
    .split(/\r?\n/)
    .map(line =>
      line
        .replace(/\[[^\]]*\]/g, "")
        .replace(/<\d+:\d+(?:\.\d+)?>/g, "")
        .trim(),
    )
    .filter(
      line =>
        line && !/^(作词|作曲|编曲|制作人|混音|母带|监制|录音|和声|吉他|贝斯|鼓|弦乐|出品|发行)\s*[:：]/.test(line),
    )
    .filter(line => !/^\{.*\}$/.test(line));
}
