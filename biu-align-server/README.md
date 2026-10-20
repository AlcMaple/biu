# biu-align-server

Biu 歌词时间轴对齐服务：客户端给出投稿（bvid + cid）和一份歌词，服务端自己去 B 站拉音频，Demucs 分离人声 → MMS_FA 强制对齐，得到每行、每字的时间。结果按「投稿 + 歌词」永久缓存，所有人共享。客户端播放时自动发起对齐，第一份对齐成功的结果直接对所有人生效，不经审核；用户上传自己的歌词、或报错「时间轴不对」，才进管理员审核。管理员也能手动对齐（插到队首、跳过缓存重跑）来判断问题出在算法还是别处。

算法为什么这样做、每个参数怎么来的：[`docs/lyrics/歌词时间轴对齐-可行方案调研.md`](../docs/lyrics/歌词时间轴对齐-可行方案调研.md) 5.2.9 ~ 5.2.14；研究过程总账：[`docs/ideas/002-歌词时间轴对齐.md`](../docs/ideas/002-歌词时间轴对齐.md)。

## 部署模型

```
[客户端] ──HTTPS──> [反代] ──> [biu-align-server :3003（仅 127.0.0.1）] ──spawn──> [worker/align.py（Python）]
                                     │                                    └─ Demucs + MMS_FA，每任务一个进程
                                     └─ 磁盘：对齐缓存、提交、审核记录
```

- **单进程**：任务队列、提交和报错写入的串行化都只在进程内有效，不能开 cluster。
- **一次只跑一个任务**：每首约 2 min CPU（Demucs 约 1.5 min + 对齐约 40 s），Python 进程峰值约 2.5 GB 内存。
- **不设排队上限和每日次数**：出队顺序是管理员手动的最先；其余按人轮转，每人先跑他最近点的那首，连切几十首的人只占自己那份。
- **对不上的记下来**：歌词与音频对不上（`LYRICS_MISMATCH` 等）和被管理员下线（`ALIGNMENT_WITHDRAWN`）记在 `failures/`，后面的听众直接拿到失败、不再排队；限流、下载失败这类服务器侧原因不记。
- **登录复用 biu-sync-server**：两边 `JWT_SECRET` 相同，客户端用 `/api/auth/exchange` 换来的 token 直接调这里。
- **不接受任意 URL**：只接受 bvid + cid，服务端校验 cid 属于该 bvid，自己调 playurl，只用非 PCDN 地址。

## 接口

所有响应 `Cache-Control: no-store`、不带 ETag。失败统一返回 `{ "error": { "code": "...", "message": "给用户看的中文" } }`， `code` 全表见 [`src/lib/errors.ts`](src/lib/errors.ts)。服务端不自动重试，客户端也不应自动重试 5xx。

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | 探活 |
| GET | `/api/me` | 登录 | `{ mid, isAdmin }`，客户端据此决定是否显示审核入口 |
| POST | `/api/align/jobs` | 登录 | `{ bvid, cid, lyrics, manual? }` → 命中缓存 200 `{ id: null, state: "done", alignment }`，记过失败 200 `{ id: null, state: "failed", error }`；否则 202 `{ id, state, position }`。`manual: true` 只对管理员生效 |
| GET | `/api/align/jobs/:id` | 登录 | 轮询（建议 3 s 一次）：`queued`（`position` = 前面几个）/ `running`（`stage` = `download` / `align`）/ `done` / `failed` |
| GET | `/api/lyrics/:bvid/:cid` | — | 对所有人生效的版本 `{ alignment, source }`，`source` = `auto` / `upload` / `admin`；没有时 `{ alignment: null, source: null }` |
| POST | `/api/lyrics/submissions` | 登录 | 上传 `{ bvid, cid, lyrics, title?, note? }`，带不带时间都行；服务端随即排队对齐，供审核员预览 |
| GET | `/api/lyrics/submissions/mine` | 登录 | 我的上传，被打回的带 `reason` |
| POST | `/api/lyrics/reports` | 登录 | 报错 `{ bvid, cid, lyricsHash, note? }`：正在看的这份时间轴不对 |
| GET | `/api/lyrics/reports/mine` | 登录 | 我的报错及处理结果 |
| GET | `/api/admin/submissions?status=pending` | 审核员 | 待审上传 |
| GET | `/api/admin/submissions/:id` | 审核员 | 上传详情 + 对齐结果（排队中为 null，对不上给 `failure`）+ 当前在用版本 |
| POST | `/api/admin/submissions/:id/approve` | 审核员 | 通过并替换当前版本，原上传版本变 `superseded` |
| POST | `/api/admin/submissions/:id/reject` | 审核员 | `{ reason }` 必填，上传者能看到 |
| GET | `/api/admin/reports?status=pending` | 审核员 | 待处理报错 |
| GET | `/api/admin/reports/:id` | 审核员 | 报错详情 + 被报的那份对齐结果 + 当前在用版本 |
| POST | `/api/admin/reports/:id/resolve` | 审核员 | 确认有误，`{ withdraw?, reason? }`；`withdraw` 同时下线那份并记下，防止被自动对齐顶回来 |
| POST | `/api/admin/reports/:id/dismiss` | 审核员 | 没问题，`{ reason }` 必填，报错人能看到 |
| POST | `/api/admin/published` | 审核员 | 手动对齐预览满意后发布 `{ bvid, cid, lyrics }`，替换当前版本并清掉这份的失败记录 |

`lyrics` 可以是 LRC（网易云、LrcLib 原样传，含制作人员行也行，服务端会清洗）或纯文本。带时间时，原时间只用来给对齐失败的行划局部重对齐窗口；纯文本也能对齐，只是少这层兜底。

`alignment` 结构见 [`src/lib/result.ts`](src/lib/result.ts) 的 `Alignment`：每行 `start` + `words[]`（每段一个汉字或一个拉丁词，标点并入前一段，拼起来等于原文），另有 `quality`（置信度）、`offsetSec`（对齐结果 − 原歌词时间的中位数）和增强 LRC 文本 `lrc`。

## Python 环境

依赖版本锁在 [`worker/requirements.txt`](worker/requirements.txt)（算法数据都在这套版本上测出；`torchaudio` 不能升到 2.9，`forced_align` 在 2.9 被移除）。建一个专用 venv，`PYTHON_BIN` 指向它：

```bash
python3 -m venv venv
venv/bin/python -m pip install -r worker/requirements.txt   # 国内可加 -i https://pypi.tuna.tsinghua.edu.cn/simple
```

模型权重首次运行时自动下载到 `~/.cache/torch/hub/checkpoints/`：MMS_FA `model.pt` 约 1.2 GB，Demucs `955717e8-8726e21a.th` 约 80 MB。国内下载慢时，可以从已有机器把这两个文件原样拷过去。装好后跑一次 worker 做冒烟测试：

```bash
venv/bin/python worker/align.py <音频> <歌词.json> /tmp/out.json /tmp/work   # 歌词.json 格式见 align.py 顶部注释
```

**音频解码**：worker 先把音频转成 wav 再分离人声。有 `ffmpeg` 用 ffmpeg（Linux 部署需要装）；没有就用 macOS 自带的 `afconvert`，它能直接读 B 站 DASH 音频，所以 macOS 上不用装 ffmpeg。

**进程优先级**：macOS 上用 launchd 跑时，`ProcessType` 不要设成 `Background`。系统会对后台进程大幅限 CPU，一首 2 分钟的任务会被拖长很多。用 `Standard` 加 `Nice 5`，既不拖慢对齐，也不挤占同机其他服务。

MMS_FA 权重是 **CC-BY-NC 4.0**（非商业）。Biu 本身非商业可以用；部署方若用于商业用途需另行评估。

## 三种开发方式

真对齐要 Python、约 1.3 GB 模型和每首约 2 分钟 CPU，但大多数开发工作用不到它。按你要改什么选：

| 你要改的 | 用哪种 | 需要 Python / 模型 | 需要 B 站网络 |
| --- | --- | --- | --- |
| 接口、队列、审核流程、错误文案；客户端界面、轮询、预览 | **① mock 模式** | 不需要 | 不需要 |
| 对齐效果本身（`worker/align.py`、判错阈值、清洗规则对结果的影响） | **② 完整本地** | 需要 | 需要 |
| 只改客户端，想看真实对齐效果 | **③ 连已部署的服务** | 不需要 | 需要 |

所有方式都先装 Node 依赖、生成配置：

```bash
pnpm install
cp .env.example .env    # JWT_SECRET 填一串随机字符；DATA_DIR 改成本机可写的目录，比如 ./.data
pnpm test               # 单测全部用假 worker，不依赖 Python
```

### ① mock 模式：几秒出假结果

```bash
pnpm dev:mock                 # 或 ALIGN_WORKER=mock pnpm dev
pnpm token 123456             # 签一个 mid=123456 的测试 token（想测审核员，就把它加进 .env 的 ADMIN_MIDS）
```

mock 模式不访问 B 站、不跑 Python，等 `MOCK_DELAY_MS`（默认 3 秒）后返回假时间轴：有原歌词时间就整体推后 0.3 s，纯文本就每行 3 秒顺排。队列、轮询、上传、报错、审核和真实模式走的是同一套代码，只有「取音频 + 对齐」两步被替换。

- 结果存在 `DATA_DIR/alignments/mock/`，和真实结果分开：之后切回真实模式不会读到假数据。
- `NODE_ENV=production` 下拒绝启动，避免假时间轴被缓存、自动发布给所有人。
- 拿不到 B 站相关的错误（限流、PCDN、下载失败）。要测这些文案，用 ② 或单测。

### ② 完整本地：真实对齐

按上面「Python 环境」装好 venv 和权重，`.env` 里 `PYTHON_BIN` 指向 venv 的 python，然后 `pnpm dev`。macOS 不用装 ffmpeg；Linux / Windows 需要 ffmpeg 在 PATH 里。只想调 `align.py`，不必起服务，直接跑：

```bash
venv/bin/python worker/align.py <音频> <歌词.json> /tmp/out.json /tmp/work
```

每首约 2 分钟。Python 进程峰值约 2.5 GB，开发机内存建议 8 GB 以上。

### ③ 连已部署的服务

客户端把对齐服务地址配到已部署的实例，token 走正常登录（客户端在同步服务 `/api/auth/exchange` 用 B 站 cookie 换取）。服务端代码不用在本地跑。注意：

- 用别人部署的实例，会占用部署方的 CPU，你播过的歌还会自动发布给所有人。fork 后长期开发，建议按「部署模型」自己部署一份。
- 只有和部署方同一个 `JWT_SECRET` 签出的 token 才能用。所以 ③ 只能走正常登录，`pnpm token` 签的在那边无效。
