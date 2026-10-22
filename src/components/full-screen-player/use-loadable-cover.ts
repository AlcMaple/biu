import { useEffect, useState } from "react";

import { formatUrlProtocol } from "@/common/utils/url";

const HDSLB_HTTP = /^http:\/\/(?:[^/]+\.)?hdslb\.com\//i;
const ATTEMPTS_PER_URL = 2;
// 和歌单列表、播放栏同一规格：它们早已加载并缓存过这张缩略图，从不失败；
// 全屏页此前直接拉原图，既没有缓存、体积又大，偶发超时的都是它
const THUMB_PARAMS = "672w_378h_1c.avif";

const upgrade = (url?: string) => formatUrlProtocol(url)?.replace(HDSLB_HTTP, m => m.replace(/^http:/i, "https:"));

const withThumb = (url: string) => (url.includes("/bfs/") && !url.includes("@") ? `${url}@${THUMB_PARAMS}` : url);

const canLoad = (src: string) =>
  new Promise<boolean>(resolve => {
    const img = new window.Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });

// 卡片封面和模糊背景各自请求同一张图：任何一边偶发失败，另一边正常，就出现「卡片有了背景没有」（反过来也有），
// 要退出重进才恢复。这里先确认哪个候选地址真能加载（每个失败时重试一次），卡片、背景、取色统一用它。
export const useLoadableCover = (candidates: (string | undefined)[]) => {
  // 每个候选先试缩略图，再试原图
  const urls = candidates
    .map(upgrade)
    .filter((u): u is string => Boolean(u))
    .flatMap(u => (withThumb(u) === u ? [u] : [withThumb(u), u]));
  const key = urls.join("|");
  const [resolved, setResolved] = useState<{ key: string; src?: string }>({ key, src: urls[0] });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const url of key ? key.split("|") : []) {
        for (let i = 0; i < ATTEMPTS_PER_URL; i += 1) {
          if (await canLoad(url)) {
            if (!cancelled) setResolved({ key, src: url });
            return;
          }
          if (cancelled) return;
        }
      }
      // 全都加载不了：交回第一个候选，卡片会显示占位，不再让背景悬空
      if (!cancelled) setResolved({ key, src: key.split("|")[0] || undefined });
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  // 候选刚换、还没验证完时先用第一个，别让封面空一下
  return resolved.key === key ? resolved.src : urls[0];
};
