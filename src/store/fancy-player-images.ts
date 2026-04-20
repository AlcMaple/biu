import { create } from "zustand";
import { persist } from "zustand/middleware";

import platform from "@/platform";

/** 缩略图最长边（px） */
const THUMB_MAX_EDGE = 160;
/** JPEG 质量 */
const JPEG_QUALITY = 0.8;
/** 并发解码批大小（canvas 同时占用的 GPU/CPU 成本） */
const THUMB_BATCH_SIZE = 8;

interface FancyPlayerImagesState {
  /** 用户导入的原图绝对路径列表（原图用于全屏播放器高清背景） */
  images: string[];
  /** 原图路径 → 缩略图路径 的映射（设置页网格展示使用） */
  thumbs: Record<string, string>;
  addImages: (paths: string[]) => Promise<void>;
  removeImage: (path: string) => Promise<void>;
  /** 为缺失缩略图的存量图片补齐（启动/首次挂载时调用） */
  backfillThumbs: () => Promise<void>;
  getRandomImage: (excludePath?: string) => string | null;
}

/** 在渲染进程用 blob URL + canvas 把任意 Chromium 可解码格式转成 160px JPEG 字节 */
async function decodeAndResize(bytes: Uint8Array): Promise<Uint8Array | null> {
  // 用结构化克隆过来的 Uint8Array 构造 Blob（blob: URL 与渲染端同源，canvas 不会被污染）
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab]);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement | null>(resolve => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = objectUrl;
    });
    if (!img) return null;

    const { naturalWidth: w0, naturalHeight: h0 } = img;
    if (!w0 || !h0) return null;

    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);

    const jpegBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!jpegBlob) return null;
    const buf = await jpegBlob.arrayBuffer();
    return new Uint8Array(buf);
  } catch (err) {
    console.warn("[fancy-player-images] decode failed", err);
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function ensureThumbForPath(sourcePath: string): Promise<string | null> {
  const cached = await platform.peekFancyPlayerThumb(sourcePath);
  if (cached) return cached;
  const source = await platform.readFancyPlayerSourceFile(sourcePath);
  if (!source) return null;
  const thumb = await decodeAndResize(source);
  if (!thumb) {
    console.warn("[fancy-player-images] cannot decode image:", sourcePath);
    return null;
  }
  return platform.saveFancyPlayerThumb(sourcePath, thumb);
}

async function generateInChunks(paths: string[], onChunk: (partial: Record<string, string>) => void): Promise<void> {
  for (let i = 0; i < paths.length; i += THUMB_BATCH_SIZE) {
    const chunk = paths.slice(i, i + THUMB_BATCH_SIZE);
    const entries = await Promise.all(chunk.map(async p => [p, await ensureThumbForPath(p)] as const));
    const partial: Record<string, string> = {};
    for (const [p, thumb] of entries) if (thumb) partial[p] = thumb;
    if (Object.keys(partial).length > 0) onChunk(partial);
  }
}

export const useFancyPlayerImages = create<FancyPlayerImagesState>()(
  persist(
    (set, get) => ({
      images: [],
      thumbs: {},
      addImages: async (paths: string[]) => {
        const existing = new Set(get().images);
        const newOnes = paths.filter(p => !existing.has(p));
        if (newOnes.length === 0) return;
        set(state => ({ images: [...state.images, ...newOnes] }));
        await generateInChunks(newOnes, partial => {
          set(state => ({ thumbs: { ...state.thumbs, ...partial } }));
        });
      },
      removeImage: async (path: string) => {
        set(state => {
          const nextThumbs = { ...state.thumbs };
          delete nextThumbs[path];
          return {
            images: state.images.filter(img => img !== path),
            thumbs: nextThumbs,
          };
        });
        try {
          await platform.removeFancyPlayerThumb(path);
        } catch {
          // 清理磁盘缩略图失败不影响列表状态
        }
      },
      backfillThumbs: async () => {
        const { images, thumbs } = get();
        const missing = images.filter(p => !thumbs[p]);
        if (missing.length === 0) return;
        await generateInChunks(missing, partial => {
          set(state => ({ thumbs: { ...state.thumbs, ...partial } }));
        });
      },
      getRandomImage: (excludePath?: string) => {
        const { images } = get();
        if (images.length === 0) return null;
        const candidates = images.length > 1 && excludePath ? images.filter(p => p !== excludePath) : images;
        return candidates[Math.floor(Math.random() * candidates.length)];
      },
    }),
    {
      name: "fancy-player-images",
      partialize: state => ({ images: state.images, thumbs: state.thumbs }),
    },
  ),
);
