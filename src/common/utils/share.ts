import { addToast } from "@heroui/react";

import { isElectron } from "@/platform/detect";

// 桌面端没有自己的网址，分享链接固定指向线上站点
const DESKTOP_SHARE_ORIGIN = "https://music.alcmaple.cn";

const BVID_RE = /^BV[0-9A-Za-z]{10}$/;

export const isValidBvid = (bvid?: string): bvid is string => !!bvid && BVID_RE.test(bvid);

export interface ShareTarget {
  bvid?: string;
  cid?: string | number;
  pageIndex?: number;
}

export const getShareOrigin = () => (isElectron ? DESKTOP_SHARE_ORIGIN : window.location.origin);

export const buildShareUrl = ({ bvid, cid, pageIndex }: ShareTarget, origin = getShareOrigin()) => {
  if (!isValidBvid(bvid)) return undefined;
  const params = new URLSearchParams();
  if (cid) params.set("cid", String(cid));
  if (pageIndex && pageIndex > 1) params.set("p", String(pageIndex));
  const query = params.toString();
  return `${origin}/#/share/${bvid}${query ? `?${query}` : ""}`;
};

export const parseShareParams = (search: string) => {
  const params = new URLSearchParams(search);
  const cid = params.get("cid") ?? undefined;
  const p = Number(params.get("p"));
  return {
    cid: cid && /^\d+$/.test(cid) ? cid : undefined,
    pageIndex: Number.isInteger(p) && p > 1 ? p : undefined,
  };
};

const writeClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非安全上下文或权限被拒时退回 execCommand
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
};

export const shareSong = async (target: ShareTarget) => {
  const url = buildShareUrl(target);
  if (!url) {
    addToast({ title: "这个内容没有可分享的视频链接", color: "warning" });
    return;
  }
  if (await writeClipboard(url)) {
    addToast({ title: "分享链接已复制", color: "success" });
  } else {
    addToast({ title: "复制失败，请检查浏览器的剪贴板权限", color: "danger" });
  }
};
