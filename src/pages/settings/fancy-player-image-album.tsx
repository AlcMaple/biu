import { useRef } from "react";

import { Button, Image, Tooltip } from "@heroui/react";
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
    // 优先用 Electron 文件选择对话框（多选）
    if (window.electron?.selectFile) {
      // 逐一选择（electron API 当前只支持单文件，循环调用）
      const path = await window.electron.selectFile();
      if (path) addImages([path]);
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
        <div className="flex flex-wrap gap-3">
          {images.map(img => (
            <div key={img} className="group relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl">
              <Image
                src={toImgSrc(img)}
                alt="背景图"
                className="h-full w-full object-cover"
                radius="lg"
                fallbackSrc={undefined}
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
                <Tooltip content="移除">
                  <button
                    className="hidden rounded-full bg-black/60 p-1 text-white transition-opacity group-hover:flex"
                    onClick={() => removeImage(img)}
                  >
                    <RiCloseLine size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
          {/* 添加更多按钮 */}
          <button
            className="border-default flex h-20 w-20 flex-shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-zinc-400 transition-colors hover:text-zinc-600"
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
