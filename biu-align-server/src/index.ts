// Biu 歌词时间轴对齐服务入口。部署约束：
//   - 单进程（任务队列、提交和报错写入的串行化都只在进程内有效）
//   - 只监听 127.0.0.1，由反代暴露到公网
import { createApp } from "./app.js";
import { AlignmentCache, FailureCache } from "./lib/alignment-cache.js";
import { downloadAudio, downloadVideo, getVideoPage } from "./lib/bilibili.js";
import { config } from "./lib/config.js";
import { mockDownloadAudio, mockDownloadVideo, mockGetVideoPage, mockRunScreen, mockRunWorker } from "./lib/mock.js";
import { AlignQueue } from "./lib/queue.js";
import { RecognizedStore } from "./lib/recognized.js";
import { ReportStore } from "./lib/reports.js";
import { ScreenQueue } from "./lib/screen-queue.js";
import { runScreen } from "./lib/screen-worker.js";
import { SubmissionStore } from "./lib/submissions.js";
import { runWorker } from "./lib/worker.js";

const mock = config.alignWorker === "mock";
const cache = new AlignmentCache(config.dataDir, mock ? "mock" : undefined);
const failures = new FailureCache(config.dataDir, mock ? "mock" : undefined);
const submissions = new SubmissionStore(config.dataDir);
const reports = new ReportStore(config.dataDir);
const recognized = new RecognizedStore(config.dataDir);
const queue = new AlignQueue({
  cache,
  failures,
  runWorker: mock ? mockRunWorker(config.mockDelayMs) : runWorker,
  getVideoPage: mock ? mockGetVideoPage : getVideoPage,
  downloadAudio: mock ? mockDownloadAudio : downloadAudio,
  workDir: config.workDir,
  // 自动对齐成功就对所有人生效：用户是来听歌的，不会等审核；出错的由听众报错、管理员处理
  onAligned: async ({ origin, bvid, cid, lyricsHash }) => {
    if (origin === "auto") await submissions.publishIfEmpty({ bvid, cid, lyricsHash, source: "auto" });
  },
});
const screen = new ScreenQueue({
  recognized,
  runScreen: mock ? mockRunScreen(config.mockDelayMs) : runScreen,
  getVideoPage: mock ? mockGetVideoPage : getVideoPage,
  downloadVideo: mock ? mockDownloadVideo : downloadVideo,
  workDir: config.workDir,
});

createApp({
  queue,
  cache,
  failures,
  submissions,
  reports,
  recognized,
  screen,
  rateLimitPerMinute: config.rateLimitPerMinute,
  corsOrigin: config.corsOrigin,
}).listen(config.port, "127.0.0.1", () => {
  console.log(`[biu-align-server] listening on http://127.0.0.1:${config.port}`);
  if (mock) console.warn("[biu-align-server] mock 模式：不访问 B 站、不跑 Python，对齐结果是假的，只用于开发");
  if (!config.adminMids.size) console.warn("[biu-align-server] ADMIN_MIDS 为空，提交的歌词没有人能审核");
});
