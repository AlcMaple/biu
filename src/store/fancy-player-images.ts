import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FancyPlayerImagesState {
  images: string[];
  addImages: (paths: string[]) => void;
  removeImage: (path: string) => void;
  getRandomImage: (excludePath?: string) => string | null;
}

export const useFancyPlayerImages = create<FancyPlayerImagesState>()(
  persist(
    (set, get) => ({
      images: [],
      addImages: (paths: string[]) =>
        set(state => ({
          images: [...state.images, ...paths.filter(p => !state.images.includes(p))],
        })),
      removeImage: (path: string) => set(state => ({ images: state.images.filter(img => img !== path) })),
      getRandomImage: (excludePath?: string) => {
        const { images } = get();
        if (images.length === 0) return null;
        const candidates = images.length > 1 && excludePath ? images.filter(p => p !== excludePath) : images;
        return candidates[Math.floor(Math.random() * candidates.length)];
      },
    }),
    {
      name: "fancy-player-images",
      partialize: state => ({ images: state.images }),
    },
  ),
);
