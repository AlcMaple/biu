import axios from "axios";

import { isWeb } from "@/platform/detect";

import { SYNC_SERVER_BASE_URL } from "./sync/config";
import { WEB_SYNC_PROXY_ROOT } from "./sync/http";

export interface SharedFolderItem {
  type: 2 | 12;
  rid: string | number;
  title: string;
  bvid?: string;
  cid?: string;
  cover?: string;
  ownerName?: string;
  ownerMid?: number;
  duration?: number | string;
  playCount?: number;
}

export interface SharedFolderData {
  code: string;
  title: string;
  cover?: string;
  ownerName?: string;
  updatedAt: number;
  items: SharedFolderItem[];
}

// 公开读取不带登录态；Web 走同源 BFF（不依赖跨域放行，沙盒也能接到本机同步服务），桌面直连同步服务
const shareHttp = axios.create({ baseURL: isWeb ? WEB_SYNC_PROXY_ROOT : SYNC_SERVER_BASE_URL, timeout: 15000 });
shareHttp.interceptors.response.use(res => res.data);

export const getSharedFolder = (code: string) => shareHttp.get<SharedFolderData>(`/share/${code}`);
