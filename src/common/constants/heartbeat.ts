/**
 * 私人FM / 心动模式相关常量。
 *
 * 数据源为「我喜欢的音乐」这个默认本地歌单：引擎从中取种子，找同 UP + 看了又看的相似单曲，
 * 过滤成「干净单曲」后与红心歌交织播放。见 src/store/heartbeat.ts。
 */

/** 「我喜欢的音乐」默认红心歌单的保留 folderId。本地歌单用负数 id（-Date.now()），永不产生 -1，可安全占用。 */
export const LIKED_FOLDER_ID = -1;

/** 默认红心歌单标题 */
export const LIKED_FOLDER_TITLE = "我喜欢的音乐";

/** 单曲净化：可接受的时长窗口（秒）。单曲绝大多数落在 1'15" ~ 7'。 */
export const SONG_MIN_SECONDS = 75;
export const SONG_MAX_SECONDS = 420;

/** 交织：每插入这么多首相似歌，才穿插 1 首红心歌（越大红心越稀疏，但队列保证至少 1 首红心） */
export const SIMILAR_PER_LIKED = 8;

/** 每个种子从各来源取的候选上限（过滤前），避免请求爆炸 */
export const PER_SEED_SPACE = 12;
export const PER_SEED_RELATED = 14;

/** 用作候选来源的种子数量上限 */
export const MAX_SEEDS = 6;

/** 一次会话构建的初始队列目标长度 */
export const INITIAL_QUEUE_TARGET = 40;

/** 队列剩余不足这么多首时触发续供 */
export const TOPUP_THRESHOLD = 8;

/** 每次续供追加的目标数量 */
export const TOPUP_BATCH = 20;

/** Stage 2（view 核验）单批最多核验多少个候选，控制请求量 */
export const VERIFY_LIMIT = 18;

/** 单个 UP 在一次构建里最多贡献几首（防同一系列/同曲风刷屏，逼出多样性） */
export const PER_UP_CAP = 2;

/** 续供时二度扩展的种子数（优先取用户主动收藏的歌，无则退回已服务候选抽样） */
export const SECOND_DEGREE_SEEDS = 3;

/** 收藏动作种子缓冲上限：滚动记录用户最近收藏的歌（含收进 B站在线收藏夹的），作二度扩展种子 */
export const MAX_FAV_SEEDS = 60;

/** 已推荐历史的持久化上限（滚动保留最近这么多首，跨会话/跨天不重复；到顶后最老的滚出、可再出现） */
export const MAX_SERVED_HISTORY = 800;

// —— Phase 2：网易相似表（第三条腿，默认开、失败即静默） ——

/** 每次构建让多少个种子走网易腿（控制回程 B站搜索量） */
export const NETEASE_SEEDS_PER_BUILD = 3;

/** 每个种子取网易相似歌的前 K 首回搜 B站 */
export const NETEASE_TOP_K = 3;

/** 网易腿单个种子的软超时（毫秒）：超时即返回空，不拖慢队列构建 */
export const NETEASE_TIMEOUT_MS = 5000;
