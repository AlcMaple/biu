import type { AxiosRequestConfig } from "axios";

import {
  resolveSandboxIdentity,
  SANDBOX_AUDIO_PATH,
  SANDBOX_AUDIO_SECONDS,
  SANDBOX_LINE_SECONDS,
} from "@shared/sandbox";

import { DEMO_USER, DEMO_VIDEOS, offlineDemoResponse } from "./offline-demo-fixtures";

// 本地沙盒（BIU_TARGET=sandbox）在离线 Demo 假数据之上改写的几处：
// 当前登录用户跟随页面选的身份；视频详情和播放地址指向本机合成音频；歌词渠道返回固定歌词

const base = (data: unknown) => ({ code: 0, message: "0", ttl: 1, data });

export const currentSandboxIdentity = () =>
  resolveSandboxIdentity(typeof document === "undefined" ? undefined : document.cookie);

export function sandboxUser() {
  const identity = currentSandboxIdentity();
  if (!identity.mid) return undefined;
  return {
    ...DEMO_USER,
    mid: Number(identity.mid),
    uname: `沙盒${identity.label}`,
    wallet: { ...DEMO_USER.wallet, mid: Number(identity.mid) },
  };
}

const paramOf = (config: AxiosRequestConfig, key: string) => {
  const params = config.params as Record<string, unknown> | URLSearchParams | undefined;
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params?.[key];
  return value == null ? undefined : String(value);
};

// isUrlValid 按 deadline 判断地址是否过期，和 B 站真实播放地址同一口径
const audioUrl = (song: number) =>
  `${window.location.origin}${SANDBOX_AUDIO_PATH}?song=${song}&deadline=${Math.floor(Date.now() / 1000) + 86_400}`;

const responseForPath = (path: string, config: AxiosRequestConfig) => {
  if (path === "/x/web-interface/nav") {
    const user = sandboxUser();
    // B 站未登录时 nav 返回 -101，data.isLogin=false
    return user ? base(user) : { code: -101, message: "账号未登录", ttl: 1, data: { isLogin: false } };
  }
  const item = DEMO_VIDEOS.find(video => video.bvid === paramOf(config, "bvid")) ?? DEMO_VIDEOS[0];
  const pages = [{ cid: item.aid + 10, page: 1, part: "正片", duration: SANDBOX_AUDIO_SECONDS, first_frame: item.pic }];
  // 切歌时只取分 P 列表，返回的 data 直接是数组
  if (path.includes("player/pagelist")) return base(pages);
  if (path.includes("web-interface/view")) {
    return base({
      aid: item.aid,
      bvid: item.bvid,
      title: item.title,
      pic: item.pic,
      duration: SANDBOX_AUDIO_SECONDS,
      owner: { mid: item.mid, name: item.author, face: item.pic },
      stat: { view: item.play },
      pages,
    });
  }
  if (path.includes("player/wbi/playurl")) {
    const url = audioUrl(item.aid);
    return base({
      quality: 64,
      format: "mp4",
      timelength: SANDBOX_AUDIO_SECONDS * 1000,
      dash: {
        duration: SANDBOX_AUDIO_SECONDS,
        video: [],
        audio: [
          {
            id: 30280,
            baseUrl: url,
            base_url: url,
            backupUrl: [],
            backup_url: [],
            bandwidth: 352_800,
            mimeType: "audio/wav",
            mime_type: "audio/wav",
            codecs: "pcm_s16le",
          },
        ],
      },
    });
  }
  return undefined;
};

export function sandboxResponse(config: AxiosRequestConfig) {
  let path = String(config.url ?? "");
  try {
    path = new URL(path, String(config.baseURL ?? "") || "http://sandbox.local").pathname;
  } catch {
    path = path.split("?")[0];
  }
  return responseForPath(path, config) ?? offlineDemoResponse(config);
}

// 歌词走「网易云」渠道：搜什么就回一首同名、同时长的歌，自动匹配必然命中。
// 「Live Session」那首模拟「查无歌词」，用来看暂无歌词的状态
const NO_LYRICS_KEYWORD = "Live Session";

// 歌词请求只带歌曲 id，所以语种编在 id 里：1 中文，2 日语，3 英文
const sandboxSongId = (keyword: string) => (keyword.includes("夏夜漫游") ? 2 : keyword.includes("Apologize") ? 3 : 1);

export function sandboxNeteaseSearch(keyword: string) {
  if (!keyword || keyword.includes(NO_LYRICS_KEYWORD)) return { result: { songs: [] } };
  return {
    result: {
      songs: [
        {
          id: sandboxSongId(keyword),
          name: keyword,
          artists: [{ name: "沙盒歌手" }],
          duration: SANDBOX_AUDIO_SECONDS * 1000,
        },
      ],
    },
  };
}

const formatTime = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.00`;

// 按歌名给不同语种，用来看报错弹窗里「译文 / 罗马音」按语种出现：
// 标题带「夏夜漫游」的是日语歌（原文 + 译文 + 罗马音），带「Apologize」的是英文歌（原文 + 译文），其余是中文歌（只有原文）
const SANDBOX_JA = [
  ["夏の夜をさまよう", "在夏夜里漫游", "natsu no yoru o samayou"],
  ["遠い街の灯りを", "远方城市的灯火", "tooi machi no akari o"],
  ["君と見たあの空", "和你看过的那片天", "kimi to mita ano sora"],
] as const;
const SANDBOX_EN = [
  ["I'm sorry that I hurt you", "对不起我伤害了你"],
  ["It's something I must live with everyday", "这是我必须每天背负的"],
  ["And all the pain I put you through", "还有我带给你的所有痛苦"],
] as const;

export function sandboxNeteaseLyrics(id?: number) {
  const groups = id === 2 ? SANDBOX_JA : id === 3 ? SANDBOX_EN : null;
  const count = SANDBOX_AUDIO_SECONDS / SANDBOX_LINE_SECONDS;
  const lines = Array.from({ length: count }, (_, i) => {
    // 从 1 秒起：[00:00.00] 在服务端算「没有时间」，原文和译文、罗马音不会被合成同一句
    const time = `[${formatTime(i * SANDBOX_LINE_SECONDS + 1)}]`;
    if (!groups) return `${time}这是沙盒测试歌词第${i + 1}句`;
    return groups[i % groups.length].map(text => `${time}${text}`).join("\n");
  });
  return { lrc: { lyric: lines.join("\n") } };
}
