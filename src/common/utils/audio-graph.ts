import { audio } from "@/store/play-list";

/**
 * 全应用唯一的 Web Audio 处理图。
 *
 * 为什么要有这个模块：`AudioContext.createMediaElementSource(el)` 对同一个媒体元素
 * 「一辈子只能调用一次」。播放器里有两处需要接入这条音频流——音量增强（GainNode）
 * 与波形可视化（AnalyserNode）——所以必须共用同一张图，否则第二个调用会抛错并静音。
 *
 * 图的结构：source -> gain -> limiter -> analyser -> destination
 * - gain：音量增强。gain=1 时对常规音频透明，默认用户零感知。
 * - limiter：限幅器（DynamicsCompressor 当 brickwall limiter 用）。把放大后超过天花板的
 *   峰值「平滑压缩」到 0 dBFS 以内，而不是让它溢出后被输出设备硬削波——这正是
 *   B 站等播放器「音量增强却不破音」的原理。不增强（gain=1）时阈值设 0，对常规音频透明。
 * - analyser：供 audio-waveform 组件读取频谱（取自限幅后的实际输出）。
 *
 * 音量增强的原理：系统音量（OS 混音器）和播放器音量（audio.volume，范围 0-1，只能衰减）
 * 都无法把信号放大到「比源更响」。GainNode 在解码后的信号上做软件放大（gain>1），
 * 不受系统音量限制，因此能救「系统音量已拉满却依然很小声」的歌。
 *
 * 为什么之前会破音：纯 GainNode 放大后，峰值会越过 ±1.0（0 dBFS），输出阶段直接硬截顶，
 * 听感就是破音。加一级限幅器把峰值压回天花板以内即可消除，安静段落仍享受完整增益。
 */

let audioContext: AudioContext | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let gainNode: GainNode | null = null;
let limiterNode: DynamicsCompressorNode | null = null;
let analyserNode: AnalyserNode | null = null;

/** 当前增益倍数：1 = 100%（不增强）。建图前先记下来，建图时套用。 */
let gainMultiplier = 1;

/**
 * 限幅器在增强时的输出天花板（dBFS）。略低于 0 留安全余量：配合 ratio=20，
 * 即便 0 dBFS 的源被放大到 3 倍（+9.5 dB），输出峰值也压在 0 dBFS 以下，绝不削波。
 */
const LIMITER_CEILING_DB = -1.5;

/**
 * 按当前增益倍数决定限幅阈值。不增强时设 0：常规音频（峰值 < 0 dBFS）完全不触发限幅，
 * 保持透明；一旦增强，压到天花板以下，超出部分被平滑限幅而非破音。
 */
const limiterThresholdFor = (multiplier: number) => (multiplier > 1 ? LIMITER_CEILING_DB : 0);

/**
 * 懒初始化共享音频图。重复调用安全（已建图则直接返回）。
 * @returns 是否就绪。浏览器不支持 Web Audio、或 createMediaElementSource 失败时返回 false，
 *   此时音频元素保持直连系统，播放不受影响。
 */
export const ensureAudioGraph = (): boolean => {
  if (audioContext) return true;

  const Ctor =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor || !audio) return false;

  try {
    audioContext = new Ctor();
    // createMediaElementSource 每个元素仅能调用一次，故全程只在这里调用
    sourceNode = audioContext.createMediaElementSource(audio);

    gainNode = audioContext.createGain();
    gainNode.gain.value = gainMultiplier;

    // 限幅器（brickwall limiter）：增益放大后用它压住峰值，杜绝硬削波带来的破音。
    limiterNode = audioContext.createDynamicsCompressor();
    limiterNode.knee.value = 0; // 硬拐点 → 真正的限幅，而非缓压
    limiterNode.ratio.value = 20; // 最大压缩比 → 接近 brickwall
    limiterNode.attack.value = 0.003; // 3ms，快到听不出又不引入自身失真
    limiterNode.release.value = 0.25;
    limiterNode.threshold.value = limiterThresholdFor(gainMultiplier);

    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 512;

    sourceNode.connect(gainNode);
    gainNode.connect(limiterNode);
    limiterNode.connect(analyserNode);
    analyserNode.connect(audioContext.destination);
    return true;
  } catch (error) {
    console.warn("音频处理图初始化失败，保持直连：", error);
    audioContext = null;
    sourceNode = null;
    gainNode = null;
    limiterNode = null;
    analyserNode = null;
    return false;
  }
};

/** 恢复被浏览器自动挂起的 AudioContext。须在用户手势（如点击播放）后调用才会生效。 */
export const resumeAudioGraph = () => {
  if (audioContext && audioContext.state === "suspended") {
    void audioContext.resume();
  }
};

/** 获取频谱分析节点（波形可视化用）。图未就绪时返回 null。 */
export const getAnalyser = (): AnalyserNode | null => {
  ensureAudioGraph();
  return analyserNode;
};

/**
 * 设置音量增强倍数。1 = 100%（不增强），上限 3（300%）。
 *
 * 当倍数为 1 且尚未建图时，刻意不建图——保持音频元素直连系统，默认用户行为零改动。
 * 一旦用户调过增强（或波形组件已建图），后续都通过这条图走。增益与限幅阈值联动：
 * 放大多少，限幅器就把峰值压回 0 dBFS 以内，所以无论拉到多高都不会破音。
 */
export const setVolumeBoost = (multiplier: number) => {
  // 容错：非法值回落到不增强；上限钳到 3（限幅器负责把放大后的峰值压回安全范围）
  const next = Number.isFinite(multiplier) ? Math.min(Math.max(multiplier, 0), 3) : 1;
  gainMultiplier = next;

  if (next === 1 && !audioContext) return;
  if (!ensureAudioGraph()) return;

  resumeAudioGraph();
  if (gainNode) gainNode.gain.value = next;
  if (limiterNode) limiterNode.threshold.value = limiterThresholdFor(next);
};
