// 测试账号专用：没有 B 站登录态也能查看听歌排行各状态的效果，不会进入真实同步链路
export type MockScenario = "data" | "empty" | "loading" | "error";

export const MOCK_SCENARIOS: { key: MockScenario; title: string }[] = [
  { key: "data", title: "有数据" },
  { key: "empty", title: "无数据" },
  { key: "loading", title: "加载中" },
  { key: "error", title: "同步失败" },
];

export const MOCK_ERROR = "同步请求受限，记录已保存在本机，请稍后再打开本页或重新登录";

const DAY = 24 * 60 * 60 * 1000;

const SONGS = [
  {
    title: "【中日字幕/第5话ED完整】死神千年血战篇-祸进谭- 特殊ED「螺旋 Acoustic Ver.」/ 9Lana【无损音质】",
    owner: "百億_光年",
    week: 12,
    total: 48,
    lossless: true,
  },
  { title: "【4K修复】千本樱 - 初音ミク【Hi-Res】", owner: "音乐收藏家", week: 9, total: 120, lossless: true },
  { title: "米津玄師 - Lemon【杜比全景声】", owner: "杜比音乐馆", week: 7, total: 33, dolby: true },
  { title: "YOASOBI「アイドル」Official Music Video", owner: "YOASOBI", week: 5, total: 61 },
  { title: "周杰伦 - 晴天（演唱会版）", owner: "怀旧金曲", week: 3, total: 27 },
  { title: "Lofi Hip Hop Radio - 学习 / 放松的节拍", owner: "Chill Beats", week: 0, total: 15 },
];

export const buildMockRecords = (now = Date.now()): PlayCountsData =>
  Object.fromEntries(
    SONGS.map((song, index) => {
      const key = `mock-${index + 1}`;
      return [
        key,
        {
          key,
          title: song.title,
          ownerName: song.owner,
          isLossless: song.lossless,
          isDolby: song.dolby,
          totalCount: song.total,
          recentPlays: Array.from({ length: song.week }, (_, i) => now - ((i + 1) * DAY) / 2 + 1),
        },
      ];
    }),
  );
