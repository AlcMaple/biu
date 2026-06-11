import { audio } from "@/store/play-list";

/**
 * 全应用唯一的 Web Audio 处理图。
 *
 * 为什么要有这个模块：`AudioContext.createMediaElementSource(el)` 对同一个媒体元素
 * 「一辈子只能调用一次」。播放器里有两处需要接入这条音频流——音量增强（GainNode）
 * 与波形可视化（AnalyserNode）——所以必须共用同一张图，否则第二个调用会抛错并静音。
 *
 * 图的结构：source -> gain -> analyser -> destination
 * - gain：音量增强。gain=1 时完全透明（逐位不变），默认用户零感知。
 * - analyser：供 audio-waveform 组件读取频谱。
 *
 * 音量增强的原理：系统音量（OS 混音器）和播放器音量（audio.volume，范围 0-1，只能衰减）
 * 都无法把信号放大到「比源更响」。GainNode 在解码后的信号上做软件放大（gain>1），
 * 不受系统音量限制，因此能救「系统音量已拉满却依然很小声」的歌。
 */

let audioContext: AudioContext | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let gainNode: GainNode | null = null;
let analyserNode: AnalyserNode | null = null;

/** 当前增益倍数：1 = 100%（不增强）。建图前先记下来，建图时套用。 */
let gainMultiplier = 1;

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

    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 512;

    sourceNode.connect(gainNode);
    gainNode.connect(analyserNode);
    analyserNode.connect(audioContext.destination);
    return true;
  } catch (error) {
    console.warn("音频处理图初始化失败，保持直连：", error);
    audioContext = null;
    sourceNode = null;
    gainNode = null;
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
 * 设置音量增强倍数。1 = 100%（不增强），上限建议 3（300%）。
 *
 * 当倍数为 1 且尚未建图时，刻意不建图——保持音频元素直连系统，默认用户行为零改动。
 * 一旦用户调过增强（或波形组件已建图），后续都通过这条图走。
 */
export const setVolumeBoost = (multiplier: number) => {
  // 容错：非法值回落到不增强；上限钳到 3 防止极端削波
  const next = Number.isFinite(multiplier) ? Math.min(Math.max(multiplier, 0), 3) : 1;
  gainMultiplier = next;

  if (next === 1 && !audioContext) return;
  if (!ensureAudioGraph()) return;

  resumeAudioGraph();
  if (gainNode) gainNode.gain.value = next;
};
