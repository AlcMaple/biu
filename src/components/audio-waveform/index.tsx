import { useEffect, useRef } from "react";

import { getAnalyser, resumeAudioGraph } from "@/common/utils/audio-graph";
import { audio as audioElement } from "@/store/play-list";

interface AudioWaveformProps {
  width?: number;
  height?: number;
  barCount?: number;
  barColor?: string;
}

/**
 * 音频波形可视化组件
 * 使用 Web Audio API 实现动态频谱效果。
 * 频谱节点取自全应用共享的音频处理图（见 @/common/utils/audio-graph），
 * 与音量增强共用同一条 MediaElementSource（每个媒体元素只能创建一次）。
 */
const AudioWaveform = ({ width = 56, height = 56, barCount = 40, barColor = "currentColor" }: AudioWaveformProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationIdRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioElement) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 取共享图的频谱节点（懒建图）。建图失败（如不支持 Web Audio）时为 null，直接跳过绘制。
    const analyser = getAnalyser();
    resumeAudioGraph();

    // Ensure context resumes on play
    const handlePlay = () => {
      resumeAudioGraph();
      if (!animationIdRef.current) {
        render();
      }
    };

    const handlePause = () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = 0;
      }
    };

    const draw = () => {
      if (!analyser || !ctx) return;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, width, height);

      const computedBarWidth = width / barCount;
      const barGap = computedBarWidth * 0.2;
      const barWidth = computedBarWidth - barGap;

      // Focus on the lower 60% of the frequency spectrum (most music energy)
      // With fftSize=512, bufferLength=256.
      // 0.6 * 256 * (44100/512) ≈ 13kHz coverage
      const usefulBufferLength = Math.floor(bufferLength * 0.6);

      // Draw bars
      for (let i = 0; i < barCount; i++) {
        // Map bar index to frequency data index
        const dataIndex = Math.floor((i / barCount) * usefulBufferLength);
        let value = dataArray[dataIndex];

        // Boost high frequencies (right side) as they are naturally quieter
        // Linear boost from 1x to 2x
        const boost = 1 + i / barCount;
        value = Math.min(255, value * boost);

        // Calculate bar height based on value (0-255)
        // Ensure a minimum height (e.g., 2px) to show a "base" row like PotPlayer
        const barHeight = Math.max((value / 255) * height, 2);

        const x = i * computedBarWidth;
        const y = height - barHeight;

        // Set color
        ctx.fillStyle = barColor === "currentColor" ? "#666" : barColor;

        // Draw rounded bar (simulated)
        ctx.beginPath();
        // Use rect for simplicity, or roundRect if supported
        if (ctx.roundRect) {
          ctx.roundRect(x, y, barWidth, barHeight, 2);
        } else {
          ctx.fillRect(x, y, barWidth, barHeight);
        }
        ctx.fill();
      }
    };

    const render = () => {
      draw();
      animationIdRef.current = requestAnimationFrame(render);
    };

    audioElement.addEventListener("play", handlePlay);
    audioElement.addEventListener("pause", handlePause);

    // Initialize state
    if (!audioElement.paused) {
      render();
    } else {
      draw();
    }

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      audioElement.removeEventListener("play", handlePlay);
      audioElement.removeEventListener("pause", handlePause);
    };
  }, [width, height, barCount, barColor]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};

export default AudioWaveform;
