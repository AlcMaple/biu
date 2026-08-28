import type { AxiosRequestConfig } from "axios";

/**
 * Local fixture data used only by the documentation build (`BIU_TARGET=demo`).
 *
 * The real pages still make their normal service calls. The request adapter maps those
 * calls to this snapshot, so the prototype exercises the same route tree, stores, menus,
 * dialogs, and responsive component branches without contacting Bilibili or a BFF.
 */

const coverPalette = [
  ["#163f5a", "#55c2b2"],
  ["#5d2d63", "#ef8aa7"],
  ["#6e3f2c", "#e2b06f"],
  ["#253951", "#8fa9db"],
  ["#385d3f", "#c7d786"],
  ["#432a5c", "#ae8fe4"],
  ["#754331", "#ef9b73"],
  ["#1f536f", "#8be1ef"],
] as const;

const svgData = (label: string, index = 0) => {
  const [from, to] = coverPalette[index % coverPalette.length];
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 672 378"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="672" height="378" fill="url(#g)"/><circle cx="555" cy="78" r="118" fill="#fff" fill-opacity=".16"/><circle cx="112" cy="315" r="170" fill="#000" fill-opacity=".12"/><text x="44" y="216" fill="#fff" font-family="Arial,sans-serif" font-size="48" font-weight="700" letter-spacing="4">${label}</text></svg>`,
  )}`;
};

const avatar = (name: string, index: number) => svgData(name.slice(0, 2).toUpperCase(), index + 2);

const now = Math.floor(Date.now() / 1000);

export const DEMO_USER = {
  isLogin: true,
  email_verified: 1,
  face: avatar("Biu", 0),
  level_info: { current_level: 6, current_min: 0, current_exp: 9999, next_exp: "--" },
  mid: 10001,
  mobile_verified: 1,
  money: 42,
  moral: 70,
  official: { role: 3, title: "个人认证", desc: "", type: 0 },
  officialVerify: { type: 0, desc: "个人认证" },
  pendant: { pid: 0, name: "", image: "", expire: 0 },
  scores: 0,
  uname: "Biu 演示用户",
  vipDueDate: now * 1000 + 86_400_000 * 365,
  vipStatus: 1,
  vipType: 2,
  vip_pay_type: 1,
  vip_theme_type: 1,
  vip_label: {
    path: "",
    text: "年度大会员",
    label_theme: "annual_vip",
    text_color: "#fff",
    bg_style: 1,
    bg_color: "#fa7d8c",
    border_color: "#fa7d8c",
  },
  vip_avatar_subscript: 1,
  vip_nickname_color: "#fb7299",
  wallet: { mid: 10001, bcoin_balance: 3, coupon_balance: 0, coupon_due_time: 0 },
  has_shop: false,
  shop_url: "",
  allowance_count: 0,
  answer_status: 0,
  is_senior_member: 0,
  wbi_img: {
    img_url: "https://example.invalid/demo-img-key.png",
    sub_url: "https://example.invalid/demo-sub-key.png",
  },
  is_jury: false,
};

const titles = [
  "【无损音质】爱在记忆中找你",
  "陈淑桦-梦醒时分（无损发烧版）",
  "百万级装备听《Apologize》",
  "这个人坏掉了",
  "蔡鹤峰&邓智伟 // 续集（原声）",
  "近半年妄想症系列涨粉实录",
  "买了李柯以的周边（开箱）",
  "衍生竞技 / part1 song mix",
  "【fgo 终章 ed】时计塔的约定",
  "谢谢每一位按下播放键的人",
  "【重音テト生誕】夏夜漫游",
  "Bobby No Peace · Live Session",
];

const authors = ["林峰", "陈淑桦", "OneRepublic", "阿遥", "りょうづき", "业务不精_你是草", "培你以生1207", "旧事屿Q"];

export const DEMO_VIDEOS = titles.map((title, index) => ({
  aid: 100_000 + index,
  bvid: `BV1DEMO${String(index + 1).padStart(2, "0")}`,
  title,
  author: authors[index % authors.length],
  pic: svgData(`BIU ${String(index + 1).padStart(2, "0")}`, index),
  mid: 20_000 + index,
  pubdate: now - index * 86_400,
  play: 1200 + index * 1837,
  video_review: 18 + index,
  favorites: 40 + index * 5,
  review: 8 + index,
  duration: `${String(3 + (index % 3)).padStart(2, "0")}:${String(12 + index * 3).padStart(2, "0")}`,
  durationSec: 192 + index * 17,
}));

export const DEMO_FAV_MEDIA = DEMO_VIDEOS.map((item, index) => ({
  id: item.aid,
  type: 2,
  title: item.title,
  cover: item.pic,
  intro: `${item.title} 的离线演示简介`,
  page: 1,
  duration: item.durationSec,
  upper: { mid: item.mid, name: item.author, face: avatar(item.author, index) },
  attr: index === 7 ? 1 : 0,
  cnt_info: { collect: 20 + index, play: item.play, danmaku: 3 + index, vt: item.play },
  link: `https://www.bilibili.com/video/${item.bvid}`,
  ctime: now - 86_400 * (index + 10),
  pubtime: item.pubdate,
  fav_time: now - 86_400 * index,
  bv_id: item.bvid,
  bvid: item.bvid,
  season: null,
}));

const demoFolder = (id: number, title: string, type = 11, cover = DEMO_VIDEOS[id % DEMO_VIDEOS.length].pic) => ({
  id,
  fid: id,
  mid: DEMO_USER.mid,
  attr: 0,
  title,
  cover,
  upper: {
    mid: DEMO_USER.mid,
    name: DEMO_USER.uname,
    face: DEMO_USER.face,
    followed: true,
    vip_type: 2,
    vip_statue: 1,
  },
  cover_type: 0,
  cnt_info: { collect: 22, play: 3680, thumb_up: 11, share: 4 },
  type,
  intro: "离线响应式验收数据",
  ctime: now - 86_400 * 30,
  mtime: now - 86_400,
  state: 0,
  fav_state: 1,
  like_state: 0,
  media_count: DEMO_FAV_MEDIA.length,
});

export const DEMO_FOLDERS = [
  demoFolder(101, "默认收藏夹", 11),
  demoFolder(102, "音乐收藏", 11, DEMO_VIDEOS[1].pic),
  demoFolder(103, "通勤歌单", 11, DEMO_VIDEOS[4].pic),
];

export const DEMO_COLLECTIONS = [
  demoFolder(201, "夜间循环", 21, DEMO_VIDEOS[2].pic),
  demoFolder(202, "夏日歌单", 21, DEMO_VIDEOS[5].pic),
].map(folder => ({ ...folder, media_count: 6, intro: "视频合集离线演示" }));

export const DEMO_SERIES = [
  demoFolder(301, "音乐现场精选", 21, DEMO_VIDEOS[6].pic),
  demoFolder(302, "翻唱与原声", 21, DEMO_VIDEOS[8].pic),
].map(folder => ({ ...folder, media_count: 6, intro: "视频系列离线演示" }));

const makeLocalItems = (items: typeof DEMO_VIDEOS, invalidIndex?: number) =>
  items.map((item, index) => ({
    rid: item.aid,
    type: 2,
    source: "online" as const,
    title: item.title,
    cover: item.pic,
    bvid: item.bvid,
    ownerName: item.author,
    ownerMid: item.mid,
    fav_time: Date.now() - index * 10_000,
    duration: item.durationSec,
    playCount: item.play,
    invalid: index === invalidIndex,
  }));

export const DEMO_LOCAL_ITEMS = {
  [-1]: makeLocalItems(DEMO_VIDEOS.slice(0, 8), 6),
  [-3]: makeLocalItems(DEMO_VIDEOS, 6),
};

const toViewItems = DEMO_VIDEOS.slice(2, 10).map((item, index) => ({
  aid: item.aid,
  videos: 1,
  tid: 3,
  is_pgc: false,
  tname: "音乐",
  copyright: 1,
  pic: item.pic,
  title: item.title,
  pubdate: item.pubdate,
  ctime: item.pubdate,
  desc: `${item.title} · 稍后再看离线样本`,
  state: 0,
  duration: item.durationSec,
  rights: {},
  owner: { mid: item.mid, name: item.author, face: avatar(item.author, index) },
  stat: { view: item.play, like: item.favorites, danmaku: item.video_review },
  dynamic: "",
  dimension: { width: 1920, height: 1080, rotate: 0 },
  cid: item.aid + 5000,
  progress: index % 2 ? 48 : -1,
  add_at: now - index * 7200,
  bvid: item.bvid,
}));

const historyItems = DEMO_VIDEOS.slice(0, 10).map((item, index) => ({
  title: item.title,
  long_title: "",
  cover: item.pic,
  covers: null,
  uri: `https://www.bilibili.com/video/${item.bvid}`,
  history: { oid: item.aid, bvid: item.bvid, page: 1, cid: item.aid + 1000, part: "正片", business: "archive", dt: 2 },
  videos: 1,
  author_name: item.author,
  author_face: avatar(item.author, index),
  author_mid: item.mid,
  view_at: now - index * 7200,
  progress: index % 3 === 0 ? 88 : -1,
  badge: index % 3 === 0 ? "看到 01:28" : undefined,
  show_title: "正片",
  duration: item.durationSec,
  current: "",
  total: 1,
  new_desc: "",
  is_finish: 1,
  is_fav: index % 2,
  kid: item.aid + 7000,
  tag_name: "音乐",
  live_status: 0,
}));

const relationUsers = Array.from({ length: 12 }, (_, index) => {
  const name = [
    "潮汐乐队",
    "知夏",
    "夏末电台",
    "南方树",
    "StarlitSkies_",
    "热单间 HEATROOM",
    "滴椎 Yuno 酱",
    "阿遥",
    "旧事屿Q",
    "快乐音箱",
    "林野",
    "北岛邮差",
  ][index];
  return {
    mid: 30_000 + index,
    attribute: index % 3 === 0 ? 6 : 2,
    mtime: now - index * 86_400,
    tag: index % 2 ? [1] : null,
    special: index === 0 ? 1 : 0,
    uname: name,
    face: avatar(name, index),
    sign: "用音乐记录每一个普通的日子",
    official_verify: { type: index % 4 === 0 ? 0 : -1, desc: index % 4 === 0 ? "音乐领域认证" : "" },
    vip: {
      vipType: index % 2,
      vipDueDate: now * 1000 + 100_000,
      vipStatus: index % 2,
      label: { text: "大会员", label_theme: "vip" },
    },
    follow_time: "2026-08-20",
  };
});

const searchUsers = relationUsers.map((item, index) => ({
  mid: item.mid,
  uname: item.uname,
  usign: item.sign,
  sex: index % 2 ? "男" : "女",
  face: item.face,
  regtime: 0,
  spacesta: 0,
  fans: 1200 + index * 327,
  videos: 8 + index,
  level: 4 + (index % 3),
  is_upuser: 1,
  is_live: index % 3 === 0 ? 1 : 0,
  room_id: index % 3 === 0 ? 10_000 + index : 0,
  room_url: "",
  is_followed: index % 2 === 0,
}));

const dynamicItems = DEMO_VIDEOS.slice(0, 7).map((item, index) => ({
  basic: {
    comment_id_str: String(item.aid),
    comment_type: 1,
    like_icon: { action_url: "", end_url: "", id: 0, start_url: "" },
    rid_str: String(item.aid),
  },
  id_str: `demo-dyn-${item.aid}`,
  modules: {
    module_author: {
      avatar: null,
      face: avatar(item.author, index),
      face_nft: false,
      following: true,
      jump_url: `/user/${item.mid}`,
      label: "",
      mid: item.mid,
      name: item.author,
      pub_action: "发布了视频",
      pub_location_text: "",
      pub_time: `${index + 1}小时前`,
      pub_ts: now - index * 3600,
      type: "normal",
    },
    module_dynamic: {
      desc: { rich_text_nodes: [], text: index % 2 ? "今天也分享一首适合夜晚循环的歌。" : "把喜欢的声音留在时间里。" },
      major: {
        type: "MAJOR_TYPE_ARCHIVE",
        archive: {
          aid: item.aid,
          bvid: item.bvid,
          cover: item.pic,
          title: item.title,
          desc: "离线演示视频卡片 · 点击可加入播放队列",
          duration_text: item.duration,
          stat: { play: item.play },
        },
      },
    },
    module_stat: {
      like: { count: 18 + index, status: index === 1 },
      comment: { count: 3 + index },
      forward: { count: 0 },
    },
  },
  type: "DYNAMIC_TYPE_AV",
  visible: true,
}));

const base = (data: unknown) => ({ code: 0, message: "0", ttl: 1, data });
const empty = () => base({});

const getParam = (config: AxiosRequestConfig, key: string) => {
  const params = config.params as Record<string, unknown> | URLSearchParams | undefined;
  if (!params) return undefined;
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  return params[key];
};

const favInfo = (id: number) => {
  const folder = DEMO_FOLDERS.find(item => item.id === id) ?? DEMO_FOLDERS[0];
  return folder;
};

const seriesInfo = (id: number) => {
  const folder = DEMO_SERIES.find(item => item.id === id) ?? DEMO_SERIES[0];
  return {
    meta: {
      category: 1,
      cover: folder.cover,
      creator: folder.upper.name,
      ctime: folder.ctime,
      description: folder.intro,
      keywords: ["音乐", "现场"],
      last_update_ts: now,
      mid: DEMO_USER.mid,
      mtime: now,
      name: folder.title,
      raw_keywords: "音乐,现场",
      series_id: id,
      state: 0,
      total: 6,
    },
    recent_aids: DEMO_VIDEOS.slice(0, 6).map(item => item.aid),
  };
};

const archives = (count = 12) =>
  DEMO_VIDEOS.slice(0, count).map(item => ({
    id: item.aid,
    title: item.title,
    cover: item.pic,
    duration: item.durationSec,
    pubtime: item.pubdate,
    bvid: item.bvid,
    upper: { mid: item.mid, name: item.author },
    cnt_info: { collect: item.favorites, play: item.play, danmaku: item.video_review, vt: item.play },
    enable_vt: 0,
    vt_display: "",
    is_self_view: false,
  }));

const searchVideoItems = DEMO_VIDEOS.map(item => ({
  aid: item.aid,
  bvid: item.bvid,
  title: item.title,
  author: item.author,
  pic: item.pic,
  mid: item.mid,
  pubdate: item.pubdate,
  play: item.play,
  video_review: item.video_review,
  favorites: item.favorites,
  review: item.review,
  duration: item.duration,
  durationSec: item.durationSec,
}));

const spaceInfo = {
  mid: DEMO_USER.mid,
  name: DEMO_USER.uname,
  sex: "保密",
  face: DEMO_USER.face,
  sign: "这是一个完全离线的响应式验收空间。",
  rank: "10000",
  level: 6,
  jointime: 0,
  moral: 70,
  silence: 0,
  coins: 42,
  fans_badge: true,
  fans_medal: { show: false },
  official: { role: 3, title: "个人认证", desc: "", type: 0 },
  vip: {
    type: 2,
    status: 1,
    due_date: now * 1000 + 86_400_000 * 365,
    label: { text: "年度大会员", img_label_uri_hans_static: "" },
  },
  top_photo_v2: { l_200h_img: svgData("PROFILE", 4) },
};

const responseForPath = (path: string, config: AxiosRequestConfig) => {
  const id = Number(
    getParam(config, "media_id") ?? getParam(config, "season_id") ?? getParam(config, "series_id") ?? 0,
  );

  if (path === "/x/web-interface/nav") return base(DEMO_USER);
  if (path.includes("music/comprehensive/web/rank")) {
    return base({
      list: searchVideoItems.map((item, index) => ({
        id: index + 1,
        music_title: item.title,
        music_id: String(item.aid),
        music_corner: "",
        jump_url: "",
        author: item.author,
        bvid: item.bvid,
        album: "Biu Demo",
        aid: String(item.aid),
        cover: item.pic,
        score: 100 - index,
        related_archive: {
          bvid: item.bvid,
          title: item.title,
          cover: item.pic,
          uid: item.mid,
          username: item.author,
          vv_count: item.play,
          duration: item.durationSec,
        },
      })),
    });
  }
  if (path.includes("region/feed/rcmd"))
    return base({
      archives: searchVideoItems.slice(0, 15).map(item => ({
        aid: item.aid,
        bvid: item.bvid,
        cid: item.aid + 10,
        title: item.title,
        cover: item.pic,
        duration: item.durationSec,
        stat: { view: item.play },
        author: { mid: item.mid, name: item.author },
      })),
    });
  if (path.includes("new/music/banner"))
    return base({
      list: searchVideoItems.slice(0, 6).map(item => ({
        music_id: String(item.aid),
        archive_title: item.title,
        music_corner: "",
        publish_time: "今天",
        jump_url: "",
        cover: item.pic,
        author: item.author,
        aid: item.aid,
        cid: item.aid + 10,
        bvid: item.bvid,
      })),
    });
  if (path.endsWith("/new/music"))
    return base({
      list: searchVideoItems.slice(0, 8).map((item, index) => ({
        id: index + 1,
        music_id: String(item.aid),
        music_title: item.title,
        music_corner: "",
        publish_time: "今天",
        jump_url: "",
        priority: index,
        rank: index + 1,
        wish_listen: false,
        wish_count: 0,
        cover: item.pic,
        author: item.author,
        album: "Biu Demo",
        aid: String(item.aid),
        cid: String(item.aid + 10),
        bvid: item.bvid,
        total_vv: item.play,
      })),
    });
  if (path.includes("wbi/search/type")) {
    const searchType = String(getParam(config, "search_type") ?? "video");
    if (searchType === "bili_user")
      return base({
        seid: "demo",
        page: 1,
        pagesize: 24,
        numResults: searchUsers.length,
        numPages: 1,
        result: searchUsers,
      });
    return base({
      seid: "demo",
      page: 1,
      pagesize: 20,
      numResults: searchVideoItems.length,
      numPages: 1,
      result: searchVideoItems,
      suggest_keyword: "",
    });
  }
  if (path.includes("history/search")) return base({ has_more: false, page: { pn: 1, total: 1 }, list: historyItems });
  if (path.includes("toview/web")) return base({ count: toViewItems.length, list: toViewItems });
  if (path.endsWith("/relation/followings") || path.endsWith("/followings/search"))
    return base({ list: relationUsers, total: relationUsers.length });
  if (path.endsWith("/relation/tags"))
    return base([
      { tagid: -10, name: "特别关注", count: 2, tip: "" },
      { tagid: 1, name: "音乐 UP", count: 6, tip: "" },
    ]);
  if (path.endsWith("/relation/tag")) return base(relationUsers.slice(0, 6));
  if (path.includes("polymer/web-dynamic/v1/feed/space") || path.includes("polymer/web-dynamic/v1/feed/all"))
    return base({ has_more: false, items: dynamicItems, offset: "", update_baseline: "demo", update_num: 0 });
  if (path.includes("space/wbi/acc/info")) return base(spaceInfo);
  if (path.includes("space/wbi/acc/relation")) return base({ relation: { attribute: 2 } });
  if (path.includes("web-interface/card")) {
    return base({
      card: {
        mid: String(DEMO_USER.mid),
        name: DEMO_USER.uname,
        face: DEMO_USER.face,
        sex: "保密",
        sign: "完全离线的响应式验收用户",
        fans: 5480,
        friend: 126,
        attention: 126,
        article: 0,
        level_info: { current_level: 6, current_min: 0, current_exp: 9999, next_exp: 10000 },
        official_verify: { type: 0, desc: "个人认证" },
        vip: { vipType: 2, vipStatus: 1, vipDueDate: DEMO_USER.vipDueDate, label: { text: "年度大会员" } },
      },
      following: true,
      archive_count: 20,
      article_count: 0,
      follower: 5480,
      like_num: 12000,
    });
  }
  if (path.endsWith("/relation/stat")) return base({ following: 126, follower: 5480, black: 0 });
  if (path.endsWith("/space/setting")) return base({ privacy: { fav_video: true } });
  if (path.includes("space/wbi/arc/search"))
    return base({ page: { pn: 1, ps: 20, count: searchVideoItems.length }, list: searchVideoItems });
  if (path.includes("seasons_series_list"))
    return base({
      items_lists: {
        page: { page_num: 1, page_size: 20, total: DEMO_COLLECTIONS.length + DEMO_SERIES.length },
        seasons_list: DEMO_COLLECTIONS.map(item => ({
          archives: [],
          meta: {
            category: 1,
            cover: item.cover,
            description: item.intro,
            mid: DEMO_USER.mid,
            name: item.title,
            ptime: item.ctime,
            season_id: item.id,
            total: item.media_count,
          },
          recent_aids: [],
        })),
        series_list: DEMO_SERIES.map(item => ({
          archives: [],
          meta: {
            category: 1,
            cover: item.cover,
            creator: DEMO_USER.uname,
            description: item.intro,
            mid: DEMO_USER.mid,
            name: item.title,
            ctime: item.ctime,
            mtime: item.mtime,
            series_id: item.id,
            total: item.media_count,
            keywords: ["音乐"],
            last_update_ts: item.mtime,
            raw_keywords: "音乐",
            state: 0,
          },
          recent_aids: [],
        })),
      },
    });
  if (path.endsWith("/series/series")) return base(seriesInfo(id));
  if (path.endsWith("/series/archives"))
    return base({
      aids: DEMO_VIDEOS.slice(0, 6).map(item => item.aid),
      page: { num: 1, size: 30, total: 6 },
      archives: DEMO_VIDEOS.slice(0, 6).map(item => ({
        aid: item.aid,
        bvid: item.bvid,
        ctime: item.pubdate,
        duration: item.durationSec,
        enable_vt: false,
        interactive_video: false,
        pic: item.pic,
        playback_position: 0,
        pubdate: item.pubdate,
        stat: { view: item.play, vt: item.play },
        state: 0,
        title: item.title,
        ugc_pay: 0,
        vt_display: "",
      })),
    });
  if (path.includes("space/fav/season/list"))
    return base({
      info: {
        id,
        season_type: 1,
        title: DEMO_COLLECTIONS.find(item => item.id === id)?.title ?? "夜间循环",
        cover: DEMO_COLLECTIONS.find(item => item.id === id)?.cover ?? DEMO_VIDEOS[2].pic,
        upper: { mid: DEMO_USER.mid, name: DEMO_USER.uname },
        cnt_info: { collect: 10, play: 100, danmaku: 0, vt: 100 },
        media_count: 6,
        intro: "合集离线演示",
        enable_vt: 0,
      },
      medias: archives(6),
    });
  if (path.includes("fav/folder/created/list-all"))
    return base({ list: DEMO_FOLDERS.map(folder => ({ ...folder, fav_state: 1 })) });
  if (path.includes("fav/folder/created/list")) return base({ count: DEMO_FOLDERS.length, list: DEMO_FOLDERS });
  if (path.includes("fav/folder/collected/list"))
    return base({ count: DEMO_COLLECTIONS.length, list: DEMO_COLLECTIONS });
  if (path.includes("fav/folder/info")) return base(favInfo(id));
  if (path.includes("fav/resource/list"))
    return base({ info: favInfo(id), medias: DEMO_FAV_MEDIA, has_more: false, ttl: now });
  if (path.includes("fav/resource/ids"))
    return base(DEMO_FAV_MEDIA.map(item => ({ id: item.id, type: item.type, bv_id: item.bvid, bvid: item.bvid })));
  if (path.includes("web-interface/view")) {
    const item = DEMO_VIDEOS[0];
    return base({
      aid: item.aid,
      bvid: item.bvid,
      title: item.title,
      pic: item.pic,
      owner: { mid: item.mid, name: item.author, face: avatar(item.author, 0) },
      stat: { view: item.play },
      pages: [
        { cid: item.aid + 10, page: 1, part: "正片", duration: item.durationSec, first_frame: item.pic },
        { cid: item.aid + 11, page: 2, part: "幕后花絮", duration: 94, first_frame: DEMO_VIDEOS[1].pic },
      ],
    });
  }
  if (path.includes("space/navnum")) {
    return base({
      video: 20,
      bangumi: 0,
      cinema: 0,
      channel: { master: 1, guest: 1 },
      favourite: { master: DEMO_FOLDERS.length, guest: DEMO_FOLDERS.length },
      tag: 0,
      article: 0,
      playlist: 0,
      album: 0,
      audio: 0,
      pugv: 0,
      season_num: DEMO_COLLECTIONS.length,
      opus: dynamicItems.length,
    });
  }
  if (path.includes("player/wbi/playurl"))
    return base({
      from: "local-demo",
      result: "suee",
      message: "",
      quality: 64,
      format: "mp4",
      timelength: 180_000,
      accept_format: "mp4",
      accept_description: ["高清"],
      accept_quality: [64],
      video_codecid: 7,
      seek_param: "start",
      seek_type: "second",
      dash: {
        duration: 180,
        minBufferTime: 1.5,
        min_buffer_time: 1.5,
        video: [],
        audio: [
          {
            id: 30280,
            baseUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=",
            base_url: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=",
            backupUrl: [],
            backup_url: [],
            bandwidth: 128000,
            mimeType: "audio/wav",
            mime_type: "audio/wav",
            codecs: "pcm_s16le",
            width: 0,
            height: 0,
            frameRate: "",
            frame_rate: "",
            sar: "",
            startWithSap: 0,
            start_with_sap: 0,
            SegmentBase: { Initialization: "", initialization: "", indexRange: "", index_range: "" },
            segment_base: { Initialization: "", initialization: "", indexRange: "", index_range: "" },
            codecid: 0,
          },
        ],
      },
    });
  if (path.includes("audio/music-service-c/song/info"))
    return base({
      id: Number(getParam(config, "sid") ?? 1),
      title: "离线音频",
      cover: DEMO_VIDEOS[0].pic,
      author: "Biu Demo",
      duration: 180,
      uid: DEMO_USER.mid,
    });
  if (path.includes("audio/music-service-c/url"))
    return base({
      type: 2,
      cdns: ["data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="],
    });
  if (path.includes("relation/relations"))
    return base(Object.fromEntries(searchUsers.map(item => [item.mid, { attribute: item.is_followed ? 2 : 0 }])));
  if (path.includes("space/fav/season/list")) return base({ info: DEMO_COLLECTIONS[0], medias: archives(6) });
  if (path.includes("main/suggest"))
    return {
      code: 0,
      result: { tag: searchVideoItems.slice(0, 5).map(item => ({ value: item.title, name: item.title })) },
    };

  // All mutating/demo-only endpoints are successful local no-ops. This lets the real
  // menus, toasts, confirmation dialogs, and optimistic updates run normally.
  if (config.method?.toLowerCase() === "post") return base(0);
  return empty();
};

export function offlineDemoResponse(config: AxiosRequestConfig) {
  const rawUrl = String(config.url ?? "");
  const baseUrl = String(config.baseURL ?? "");
  let path = rawUrl;
  try {
    path = new URL(rawUrl, baseUrl || "http://offline.demo").pathname;
  } catch {
    path = rawUrl.split("?")[0];
  }
  return responseForPath(path, config);
}

export const DEMO_STORE_DATA = {
  appSettings: {
    themeMode: "dark",
    localMusicDirs: ["/offline-demo/music"],
    displayMode: "list",
  },
  user: DEMO_USER,
  favorites: {
    createdFavorites: [
      {
        id: -1,
        title: "我喜欢的音乐",
        cover: DEMO_VIDEOS[0].pic,
        type: 11,
        mid: DEMO_USER.mid,
        isLocal: true,
        isDefault: true,
      },
      { id: -2, title: "本地试听", cover: DEMO_VIDEOS[3].pic, type: 11, mid: DEMO_USER.mid, isLocal: true },
      { id: -3, title: "all", cover: DEMO_VIDEOS[0].pic, type: 11, mid: DEMO_USER.mid, isLocal: true },
    ],
    createdOrder: [-1, -2, -3],
    collectedOrder: DEMO_COLLECTIONS.map(item => item.id),
  },
  localFavItems: { folderItems: DEMO_LOCAL_ITEMS },
  tags: {
    tags: [{ id: 1, name: "音乐", color: "#1ed760" }],
    itemTags: Object.fromEntries(DEMO_VIDEOS.slice(0, 6).map(item => [String(item.aid), [1]])),
  },
  searchHistory: { keyword: "", items: [] },
};

export const DEMO_DOWNLOAD_TASKS = [
  {
    id: "demo-download-1",
    outputFileType: "audio",
    title: DEMO_VIDEOS[0].title,
    cover: DEMO_VIDEOS[0].pic,
    bvid: DEMO_VIDEOS[0].bvid,
    cid: DEMO_VIDEOS[0].aid + 1000,
    status: "completed",
    progress: 1,
    downloadedBytes: 7_530_000,
    totalBytes: 7_530_000,
    createdTime: Date.now() - 86_400_000,
    audioCodecs: "flac",
    audioBandwidth: 1411,
  },
  {
    id: "demo-download-2",
    outputFileType: "video",
    title: DEMO_VIDEOS[2].title,
    cover: DEMO_VIDEOS[2].pic,
    bvid: DEMO_VIDEOS[2].bvid,
    cid: DEMO_VIDEOS[2].aid + 1000,
    status: "downloading",
    progress: 0.42,
    downloadedBytes: 12_200_000,
    totalBytes: 28_900_000,
    createdTime: Date.now() - 3_600_000,
    videoResolution: "1080P",
    videoFrameRate: "60",
  },
];

export const DEMO_LOCAL_MUSIC = DEMO_VIDEOS.slice(0, 8).map((item, index) => ({
  id: `demo-local-${index + 1}`,
  path: `/offline-demo/music/${index + 1}.m4a`,
  dir: "/offline-demo/music",
  name: `${item.title}.m4a`,
  title: item.title,
  artist: item.author,
  album: "Biu 离线专辑",
  duration: item.durationSec,
  size: 4_200_000 + index * 180_000,
  format: "m4a",
  createdTime: Date.now() - index * 86_400_000,
}));
