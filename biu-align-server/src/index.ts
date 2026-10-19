// Biu 歌词时间轴对齐服务入口。部署约束：
//   - 单进程（任务队列、配额、提交写入的串行化都只在进程内有效）
//   - 只监听 127.0.0.1，由反代暴露到公网
import { createApp } from "./app.js";
import { AlignmentCache } from "./lib/alignment-cache.js";
import { isAdmin } from "./lib/auth.js";
import { downloadAudio, getVideoPage } from "./lib/bilibili.js";
import { config } from "./lib/config.js";
import { mockDownloadAudio, mockGetVideoPage, mockRunWorker } from "./lib/mock.js";
import { AlignQueue } from "./lib/queue.js";
import { SubmissionStore } from "./lib/submissions.js";
import { runWorker } from "./lib/worker.js";

const mock = config.alignWorker === "mock";
const cache = new AlignmentCache(config.dataDir, mock ? "mock" : undefined);
const queue = new AlignQueue({
  cache,
  runWorker: mock ? mockRunWorker(config.mockDelayMs) : runWorker,
  getVideoPage: mock ? mockGetVideoPage : getVideoPage,
  downloadAudio: mock ? mockDownloadAudio : downloadAudio,
  workDir: config.workDir,
  queueMax: config.queueMax,
  dailyQuota: config.dailyQuota,
  isAdmin,
});
const submissions = new SubmissionStore(config.dataDir);

createApp({
  queue,
  cache,
  submissions,
  rateLimitPerMinute: config.rateLimitPerMinute,
  corsOrigin: config.corsOrigin,
}).listen(config.port, "127.0.0.1", () => {
  console.log(`[biu-align-server] listening on http://127.0.0.1:${config.port}`);
  if (mock) console.warn("[biu-align-server] mock 模式：不访问 B 站、不跑 Python，对齐结果是假的，只用于开发");
  if (!config.adminMids.size) console.warn("[biu-align-server] ADMIN_MIDS 为空，提交的歌词没有人能审核");
});
