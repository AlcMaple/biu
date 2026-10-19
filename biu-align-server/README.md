# biu-align-server

Biu 歌词时间轴对齐服务：客户端给出投稿（bvid + cid）和一份歌词，服务端自己去 B 站拉音频，
Demucs 分离人声 → MMS_FA 强制对齐，得到每行、每字的时间。结果按「投稿 + 歌词」永久缓存，所有人共享。
用户上传 / 纠错的歌词经审核员通过后，成为这个投稿对所有人生效的歌词。

算法为什么这样做、每个参数怎么来的：[`docs/lyrics/歌词时间轴对齐-可行方案调研.md`](../docs/lyrics/歌词时间轴对齐-可行方案调研.md)
5.2.9 ~ 5.2.14；研究过程总账：[`docs/ideas/002-歌词时间轴对齐.md`](../docs/ideas/002-歌词时间轴对齐.md)。

## 部署模型

```
[客户端] ──HTTPS──> [反代] ──> [biu-align-server :3003（仅 127.0.0.1）] ──spawn──> [worker/align.py（Python）]
                                     │                                    └─ Demucs + MMS_FA，每任务一个进程
                                     └─ 磁盘：对齐缓存、提交、审核记录
```

- **单进程**：任务队列、每日配额、提交写入的串行化都只在进程内有效，不能开 cluster。
- **一次只跑一个任务**：每首约 2 min CPU（Demucs 约 1.5 min + 对齐约 40 s），Python 进程峰值约 2.5 GB 内存。
- **登录复用 biu-sync-server**：两边 `JWT_SECRET` 相同，客户端用 `/api/auth/exchange` 换来的 token 直接调这里。
- **不接受任意 URL**：只接受 bvid + cid，服务端校验 cid 属于该 bvid，自己调 playurl，只用非 PCDN 地址。

## 接口

所有响应 `Cache-Control: no-store`、不带 ETag。失败统一返回 `{ "error": { "code": "...", "message": "给用户看的中文" } }`，
`code` 全表见 [`src/lib/errors.ts`](src/lib/errors.ts)。服务端不自动重试，客户端也不应自动重试 5xx。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | — | 探活 |
| GET | `/api/me` | 登录 | `{ mid, isAdmin }`，客户端据此决定是否显示审核入口 |
| POST | `/api/align/jobs` | 登录 | `{ bvid, cid, lyrics }` → 命中缓存 200 `{ id: null, state: "done", alignment }`；否则 202 `{ id, state, position }` |
| GET | `/api/align/jobs/:id` | 登录 | 轮询（建议 3 s 一次）：`queued`（`position` = 前面几个）/ `running`（`stage` = `download` / `align`）/ `done` / `failed` |
| GET | `/api/lyrics/:bvid/:cid` | — | 审核通过、对所有人生效的歌词；没有时 `{ alignment: null }` |
| POST | `/api/lyrics/submissions` | 登录 | `{ bvid, cid, lyrics, note? }`，这份歌词必须先对齐成功（用户预览过）才能提交 |
| GET | `/api/lyrics/submissions/mine` | 登录 | 我的提交，被打回的带 `reason` |
| GET | `/api/admin/submissions?status=pending` | 审核员 | 待审列表 |
| GET | `/api/admin/submissions/:id` | 审核员 | 提交详情 + 本次对齐结果 + 当前在用版本 |
| POST | `/api/admin/submissions/:id/approve` | 审核员 | 通过，原在用版本变 `superseded` |
| POST | `/api/admin/submissions/:id/reject` | 审核员 | `{ reason }` 必填，上传者能看到 |

`lyrics` 可以是 LRC（网易云、LrcLib 原样传，含制作人员行也行，服务端会清洗）或纯文本。
带时间时，原时间只用来给对齐失败的行划局部重对齐窗口；纯文本也能对齐，只是少这层兜底。

`alignment` 结构见 [`src/lib/result.ts`](src/lib/result.ts) 的 `Alignment`：每行 `start` + `words[]`（每段一个汉字或一个拉丁词，
标点并入前一段，拼起来等于原文），另有 `quality`（置信度）、`offsetSec`（对齐结果 − 原歌词时间的中位数）和增强 LRC 文本 `lrc`。

## Python 环境

worker 依赖：`torch`、`torchaudio`（含 MMS_FA，首次运行会下载约 1.2 GB 权重到 `~/.cache/torch`）、`demucs`（首次约 80 MB 权重）、
`pypinyin`、`soundfile`、`scipy`、`numpy`。`PYTHON_BIN` 指向装好这些包的解释器。部署后先手动跑一次下载权重：

```bash
python worker/align.py <任意音频> <歌词.json> /tmp/out.json /tmp/work
```

MMS_FA 权重是 **CC-BY-NC 4.0**（非商业）。Biu 本身非商业可以用；部署方若用于商业用途需另行评估。

## 本地开发

```bash
pnpm install
cp .env.example .env   # JWT_SECRET 与本地 biu-sync-server 相同；PYTHON_BIN、DATA_DIR 按本机填
pnpm dev
pnpm test
```
