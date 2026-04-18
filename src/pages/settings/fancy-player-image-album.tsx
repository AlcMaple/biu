import { useRef } from "react";

import { Button } from "@heroui/react";
import { RiAddLine, RiCloseLine, RiImageLine } from "@remixicon/react";
import { useShallow } from "zustand/shallow";

import { useFancyPlayerImages } from "@/store/fancy-player-images";

/** 将本地路径转为 img src */
const toImgSrc = (path: string) => {
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) {
    return path;
  }
  const normalized = path.replace(/\\/g, "/");
  return `file://${normalized.startsWith("/") ? "" : "/"}${normalized}`;
};

const FancyPlayerImageAlbum = () => {
  const { images, addImages, removeImage } = useFancyPlayerImages(
    useShallow(s => ({ images: s.images, addImages: s.addImages, removeImage: s.removeImage })),
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelectFiles = async () => {
    if (window.electron?.selectImages) {
      const paths = await window.electron.selectImages();
      if (paths.length > 0) addImages(paths);
      return;
    }
    inputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const paths = files.map(f => (f as any).path || URL.createObjectURL(f));
    if (paths.length > 0) addImages(paths);
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-500">
          {images.length === 0
            ? "尚未添加图片，切换歌曲时将使用歌曲封面作为背景"
            : `已添加 ${images.length} 张图片，切换歌曲时随机选取`}
        </div>
        <Button size="sm" variant="flat" startContent={<RiAddLine size={16} />} onPress={handleSelectFiles}>
          添加图片
        </Button>
      </div>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map(img => (
            <div
              key={img}
              className="group relative h-20 w-20 flex-shrink-0"
              style={{ contentVisibility: "auto", containIntrinsicSize: "5rem 5rem" }}
            >
              {/* 图片 */}
              <img
                src={toImgSrc(img)}
                alt="背景图"
                loading="lazy"
                decoding="async"
                width={80}
                height={80}
                className="h-full w-full rounded-xl object-cover shadow-sm transition-transform duration-200 group-hover:scale-[1.03]"
                draggable={false}
              />
              {/* 删除按钮 —— 右上角圆形 badge，hover 时显示 */}
              <button
                className="absolute -top-1.5 -right-1.5 flex h-5 w-5 scale-75 items-center justify-center rounded-full bg-zinc-800 text-white opacity-0 shadow transition-all duration-150 group-hover:scale-100 group-hover:opacity-100 hover:bg-red-500"
                onClick={() => removeImage(img)}
                title="移除"
              >
                <RiCloseLine size={12} />
              </button>
            </div>
          ))}

          {/* 添加更多 */}
          <button
            className="border-default flex h-20 w-20 flex-shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600"
            onClick={handleSelectFiles}
          >
            <RiImageLine size={20} />
            <span className="text-[10px]">添加</span>
          </button>
        </div>
      )}

      {/* hidden file input fallback */}
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleInputChange} />
    </div>
  );
};

export default FancyPlayerImageAlbum;
