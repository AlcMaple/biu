import { useEffect, useRef } from "react";

import { getAnalyser, resumeAudioGraph } from "@/common/utils/audio-graph";
import { isElectron } from "@/platform";
import { usePlayList } from "@/store/play-list";
import { usePlayProgress } from "@/store/play-progress";

import { getBassEnergy, getStageProgress } from "./stage-signal";

/** Decorative drawing only: one shared analyser, no new media source or playback clock. */
export default function CinematicStage({ running }: { running: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const root = canvas.closest<HTMLElement>(".fancy-player");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = 0;
    let width = 1;
    let height = 1;
    let energy = 0;
    let average = 0;
    let pulse = 0;
    let lastBeat = -1000;
    let analyser: AnalyserNode | null = null;
    let bins = new Uint8Array(0);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = (now: number) => {
      frame = 0;
      const animate = running && !reduced.matches;
      if (animate && last && now - last < 1000 / 30) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      if (animate) elapsedRef.current += dt;
      const t = elapsedRef.current;
      const progress = getStageProgress(usePlayProgress.getState().currentTime, usePlayList.getState().duration ?? 0);
      if (analyser && animate) analyser.getByteFrequencyData(bins);
      const raw = animate ? getBassEnergy(bins) : 0;
      energy += (raw - energy) * 0.18;
      average += (raw - average) * 0.035;
      if (raw > 0.18 && raw > average * 1.22 && t - lastBeat > 0.7) {
        pulse = 1;
        lastBeat = t;
      }
      pulse *= 0.9;
      const hue = 35 + 170 * Math.sin(progress * Math.PI);
      root?.style.setProperty("--stage-energy", energy.toFixed(3));
      root?.style.setProperty("--stage-hue", `${hue.toFixed(1)}deg`);
      ctx.clearRect(0, 0, width, height);
      const x = width * 0.24;
      const y = height * 0.49;
      const radius = Math.min(width * 0.25, height * 0.42);

      // Sweeping spotlights stay on the artwork side, away from the lyric baseline.
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(x, height * 1.15);
        ctx.rotate(Math.sin(t * 0.17 + i * 2) * 0.32 + (i - 1) * 0.42);
        const light = ctx.createLinearGradient(0, 0, 0, -height * 1.5);
        light.addColorStop(0, `hsla(${hue + i * 25},80%,70%,0)`);
        light.addColorStop(0.6, `hsla(${hue + i * 25},80%,70%,${0.035 + energy * 0.08})`);
        light.addColorStop(1, "transparent");
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(-width * 0.13, -height * 1.5);
        ctx.lineTo(width * 0.13, -height * 1.5);
        ctx.lineTo(10, 0);
        ctx.fill();
        ctx.restore();
      }
      // Perspective dust: density and travel increase gradually through the track.
      for (let i = 0; i < 64; i++) {
        const z = (((i * 0.618 + t * (0.035 + progress * 0.035)) % 1) + 1) % 1;
        const angle = i * 2.399 + t * 0.018;
        const distance = radius * (0.4 + z * 1.8);
        const px = x + Math.cos(angle) * distance;
        const py = y + Math.sin(angle) * distance * 0.75;
        const alpha = Math.sin(z * Math.PI) * 0.5;
        ctx.fillStyle = `hsla(${hue + (i % 30)},75%,80%,${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, 0.6 + z * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Segmented halo combines real spectrum energy with a progress-driven orbit.
      for (let i = 0; i < 90; i++) {
        const angle = (i / 90) * Math.PI * 2 + t * 0.055;
        const sample = bins.length && animate ? bins[1 + (i % Math.min(90, bins.length - 1))] / 255 : 0;
        const r = radius * (0.85 + pulse * 0.035);
        ctx.strokeStyle = `hsla(${hue},85%,78%,${0.18 + sample * 0.45})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
        ctx.lineTo(x + Math.cos(angle) * (r + 4 + sample * 35), y + Math.sin(angle) * (r + 4 + sample * 35));
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      if (animate) frame = requestAnimationFrame(draw);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (running && !reduced.matches && isElectron && !analyser) {
        analyser = getAnalyser();
        if (analyser) bins = new Uint8Array(analyser.frequencyBinCount);
        resumeAudioGraph();
      }
      frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(() => {
      resize();
      restart();
    });
    observer.observe(canvas);
    reduced.addEventListener("change", restart);
    resize();
    restart();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      reduced.removeEventListener("change", restart);
      root?.style.removeProperty("--stage-energy");
      root?.style.removeProperty("--stage-hue");
    };
  }, [running]);

  return <canvas ref={canvasRef} className="fancy-player-cinema" aria-hidden />;
}
