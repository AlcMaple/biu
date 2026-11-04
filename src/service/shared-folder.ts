import axios from "axios";

import { SYNC_SERVER_BASE_URL } from "./sync/config";

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

// 公开读取不带登录态，所有平台（含 Web）直接访问同步服务
const shareHttp = axios.create({ baseURL: SYNC_SERVER_BASE_URL, timeout: 15000 });
shareHttp.interceptors.response.use(res => res.data);

export const getSharedFolder = (code: string) => shareHttp.get<SharedFolderData>(`/share/${code}`);
