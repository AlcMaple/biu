import { type RefObject, useEffect, useRef } from "react";

import { getAnalyser } from "@/common/utils/audio-graph";

export interface NebulaApi {
  /** 长按彩蛋：冲击波 + 红心流星雨 + 全场染成粉红 */
  burst: () => void;
  /** 蓄力 0~1：长按过程中粒子向中心聚拢、变亮 */
  setCharge: (v: number) => void;
}

interface Props {
  seed: string;
  cover: string;
  playing: boolean;
  lite: boolean;
  /** 唱片元素：星云绕它的中心旋转 */
  anchorRef: RefObject<HTMLElement | null>;
  apiRef: RefObject<NebulaApi | null>;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const makeRng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** 取封面的主色相；跨域画布被污染时抛错，调用方回落到 seed 派生色相。 */
const extractHue = (src: string): Promise<number | null> =>
  new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 16;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 16, 16);
        const d = ctx.getImageData(0, 0, 16, 16).data;
        let x = 0;
        let y = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i] / 255;
          const g = d[i + 1] / 255;
          const b = d[i + 2] / 255;
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const sat = mx === 0 ? 0 : (mx - mn) / mx;
          if (sat < 0.2 || mx < 0.25) continue;
          let h = 0;
          if (mx !== mn) {
            if (mx === r) h = ((g - b) / (mx - mn)) % 6;
            else if (mx === g) h = (b - r) / (mx - mn) + 2;
            else h = (r - g) / (mx - mn) + 4;
          }
          const w = sat * mx;
          x += Math.cos((h * Math.PI) / 3) * w;
          y += Math.sin((h * Math.PI) / 3) * w;
        }
        if (x === 0 && y === 0) return resolve(null);
        resolve(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

interface Star {
  arm: number;
  r: number;
  ang: number;
  w: number;
  size: number;
  mix: number;
  tw: number;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  heart: boolean;
}

const heartPath = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.5, y - s * 1.1, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 1.1, x + s, y - s * 0.4, x, y + s * 0.35);
  ctx.fill();
};

const PINK = 345;

export const NebulaCanvas = ({ seed, cover, playing, lite, anchorRef, apiRef }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const h32 = hash(seed || "biu");
    const rnd = makeRng(h32);
    // 每首歌的「性格」：旋臂数、扭转度、方向、色相偏移，全由 seed 决定，所以每首都不一样
    const arms = 2 + Math.floor(rnd() * 4);
    const twist = 2.2 + rnd() * 3.2;
    const dir = rnd() < 0.5 ? 1 : -1;
    const hueGap = 35 + rnd() * 110;
    let hue1 = h32 % 360;
    // 四种形态按歌曲种子选取：星盘 / 曲速穿梭 / 同心轨道 / 萤火上升
    const mode = (h32 >>> 8) % 4;
    const count = lite ? 90 : mode === 0 ? 360 : 260;
    const stars: Star[] = Array.from({ length: count }, () => {
      const r = 0.16 + Math.pow(rnd(), 0.8) * 0.9;
      return {
        arm: Math.floor(rnd() * arms),
        r,
        ang: (rnd() - 0.5) * (0.5 + r * 0.9),
        w: (0.25 / Math.sqrt(r)) * (0.6 + rnd() * 0.8),
        size: 0.6 + rnd() * (lite ? 1.6 : 2.2),
        mix: rnd(),
        tw: rnd() * Math.PI * 2,
      };
    });

    let cancelled = false;
    void extractHue(cover).then(h => {
      if (!cancelled && h != null) hue1 = h;
    });

    let dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 2);
    let W = 0;
    let H = 0;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let bass = 0;
    let treble = 0;
    let charge = 0;
    let tint = 0; // 彩蛋后的粉红染色，缓慢褪去
    let flash = 0;
    const waves: { r: number; a: number }[] = [];
    const sparks: Spark[] = [];
    let freq: Uint8Array<ArrayBuffer> | null = null;

    (apiRef as { current: NebulaApi | null }).current = {
      setCharge: v => {
        charge = v;
      },
      burst: () => {
        tint = 1;
        flash = 1;
        waves.push({ r: 0, a: 1 }, { r: -60, a: 0.7 });
        const c = center();
        const n = lite ? 40 : 130;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 2 + Math.random() * 9;
          sparks.push({
            x: c.x,
            y: c.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 1.5,
            life: 1,
            size: 4 + Math.random() * 10,
            heart: Math.random() < 0.55,
          });
        }
      },
    };

    function center() {
      const el = anchorRef.current;
      const cr = canvas!.getBoundingClientRect();
      if (!el) return { x: W / 2, y: H / 2 };
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height / 2 - cr.top };
    }

    let raf = 0;
    let last = performance.now();
    let t = 0;
    let lastDraw = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      // 帧率上限：普通 ~40fps，简化 / 暂停 ~24fps；切到后台直接跳过
      if (document.hidden || now - lastDraw < (lite || !playingRef.current ? 41 : 25)) return;
      lastDraw = now;
      const on = playingRef.current;
      t += dt * (on ? 1 : 0.15);

      // 音频驱动：低频 → 星云呼吸/扩散，高频 → 闪烁
      let b = 0;
      let tr = 0;
      const an = on ? getAnalyser() : null;
      if (an) {
        freq ??= new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(freq);
        for (let i = 1; i < 7; i++) b += freq[i];
        for (let i = 40; i < 140; i++) tr += freq[i];
        b /= 6 * 255;
        tr /= 100 * 255;
      } else if (on) {
        b = 0.35 + Math.sin(t * 3.2) * 0.15;
        tr = 0.25 + Math.sin(t * 7.1) * 0.1;
      }
      bass += (b - bass) * 0.25;
      treble += (tr - treble) * 0.25;

      const { x: cx, y: cy } = center();
      const R = Math.min(W, H) * 0.5;
      const hueA = hue1 + (PINK - hue1) * tint * 0 + (tint > 0 ? (((PINK - hue1 + 540) % 360) - 180) * tint : 0);
      const hueB = hueA + hueGap;

      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${lite ? 0.5 : 0.16})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = lite ? "source-over" : "lighter";

      // 中心辉光：随低频呼吸
      const glowR = R * (0.55 + bass * 0.5 + charge * 0.25);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      g.addColorStop(0, `hsla(${hueA},90%,60%,${0.16 + bass * 0.22 + charge * 0.3})`);
      g.addColorStop(1, `hsla(${hueB},90%,50%,0)`);
      ctx.fillStyle = g;
      ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);

      const lum = 65 + treble * 20;
      if (mode === 1) {
        // 曲速穿梭：星点从中心向外拉出光条，两色各一次描边
        ctx.lineCap = "round";
        for (let k = 0; k < 2; k++) {
          ctx.strokeStyle = `hsla(${k ? hueB : hueA},90%,${lum}%,${0.55 + treble * 0.4})`;
          ctx.lineWidth = lite ? 1.2 : 1.8;
          ctx.beginPath();
          for (const s of stars) {
            if (s.mix < 0.5 !== !k) continue;
            const p = (t * s.w * 0.35 * (1 + bass * 1.5) + s.tw) % 1;
            const ca = Math.cos(s.tw * 7 + s.arm);
            const sa = Math.sin(s.tw * 7 + s.arm);
            const r1 = R * 1.25 * Math.pow(p, 1.7) * (1 - charge * 0.4) + R * 0.3;
            const r0 = r1 - (6 + p * 26) * (1 + bass);
            ctx.moveTo(cx + ca * r0, cy + sa * r0 * 0.75);
            ctx.lineTo(cx + ca * r1, cy + sa * r1 * 0.75);
          }
          ctx.stroke();
        }
      } else {
        for (const s of stars) {
          let x: number;
          let y: number;
          let a: number;
          const tw = 0.55 + 0.45 * Math.sin(t * 3 + s.tw) + treble * 0.9;
          if (mode === 0) {
            const ang = dir * (t * s.w) + (s.arm * Math.PI * 2) / arms + s.r * twist + s.ang;
            const rr = R * s.r * (1 + bass * 0.12 * (1.2 - s.r)) * (1 - charge * 0.35);
            x = cx + Math.cos(ang) * rr;
            y = cy + Math.sin(ang) * rr * 0.62; // 压扁成倾斜星盘
            a = (0.25 + 0.5 * (1 - s.r)) * tw;
          } else if (mode === 2) {
            // 同心轨道：环间交替反向旋转，低频让外环整体弹一下
            const ring = s.arm % 6;
            const rr = R * (0.3 + ring * 0.13) * (1 + bass * 0.1 * ring * 0.4) * (1 - charge * 0.35);
            const ang = (ring % 2 ? -1 : 1) * dir * t * (0.5 - ring * 0.05) + s.tw * 3 + s.ang;
            x = cx + Math.cos(ang) * rr;
            y = cy + Math.sin(ang) * rr * 0.7;
            a = 0.5 * tw;
          } else {
            // 萤火上升：自下而上飘起并左右摇摆，向中心聚拢时被蓄力吸住
            const p = (t * s.w * 0.12 + s.tw) % 1;
            const spread = (s.mix - 0.5) * R * 2.6 * (1 - charge * 0.7);
            x = cx + spread + Math.sin(t * 0.9 + s.tw * 9) * 18;
            y = cy + R * 0.75 - p * R * 1.7;
            a = Math.sin(p * Math.PI) * 0.9 * tw;
          }
          ctx.fillStyle = `hsla(${hueA + (hueB - hueA) * s.mix},90%,${lum}%,${Math.min(1, a + charge * 0.4)})`;
          const sz = s.size * (1 + treble * 0.8 + charge);
          ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        }
      }

      // 冲击波
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i];
        w.r += dt * 900;
        w.a -= dt * 0.9;
        if (w.a <= 0) {
          waves.splice(i, 1);
          continue;
        }
        if (w.r < 0) continue;
        ctx.strokeStyle = `hsla(${PINK},95%,70%,${w.a})`;
        ctx.lineWidth = 3 + w.a * 8;
        ctx.beginPath();
        ctx.ellipse(cx, cy, w.r, w.r * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 红心/星屑
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.975;
        p.vy = p.vy * 0.975 + 0.06;
        p.life -= dt * 0.45;
        if (p.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.fillStyle = `hsla(${PINK + (i % 3) * 8},95%,${65 + p.life * 15}%,${p.life})`;
        if (p.heart) heartPath(ctx, p.x, p.y, p.size * (0.6 + p.life * 0.4));
        else ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }

      if (flash > 0.01) {
        ctx.fillStyle = `hsla(${PINK},100%,85%,${flash * 0.35})`;
        ctx.fillRect(0, 0, W, H);
        flash *= 0.9;
      }
      tint = Math.max(0, tint - dt / 9);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      (apiRef as { current: NebulaApi | null }).current = null;
    };
  }, [seed, cover, lite, anchorRef, apiRef]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
};
