# biu-align-server

Biu 歌词时间轴对齐服务：客户端给出投稿（bvid + cid）和一份歌词，服务端自己去 B 站拉音频，Demucs 分离人声 → 强制对齐，得到每行、每字的时间。支持中文、日语、韩语、英语：中日韩用 MMS_FA（日语先用 MeCab 取读音），英语用在歌声上训练的音素模型。结果按「投稿 + 歌词」永久缓存，所有人共享。客户端播放时自动发起对齐，第一份对齐成功的结果直接对所有人生效，不经审核；用户上传自己的歌词、或报错「时间轴不对」，才进管理员审核。管理员也能手动对齐（插到队首、跳过缓存重跑）来判断问题出在算法还是别处。

算法为什么这样做、每个参数怎么来的：中文见 [`docs/lyrics/歌词时间轴对齐-可行方案调研.md`](../docs/lyrics/歌词时间轴对齐-可行方案调研.md) 5.2.9 ~ 5.2.14，其他语种见 [`docs/lyrics/歌词时间轴对齐-多语言方案调研.md`](../docs/lyrics/歌词时间轴对齐-多语言方案调研.md)；研究过程总账：[`docs/ideas/002-歌词时间轴对齐.md`](../docs/ideas/002-歌词时间轴对齐.md)。

## 部署模型

```
[客户端] ──HTTPS──> [反代] ──> [biu-align-server :3003（仅 127.0.0.1）] ──spawn──> [worker/align.py（Python）]
                                     │                                    └─ Demucs + MMS_FA，每任务一个进程
                                     └─ 磁盘：对齐缓存、提交、审核记录
```

- **单进程**：任务队列、提交和报错写入的串行化都只在进程内有效，不能开 cluster。
- **一次只跑一个任务**：每首约 2 min CPU（Demucs 约 1.5 min + 对齐约 40 s；英语歌对齐约 10 s），Python 进程峰值约 2.5 GB 内存，英语歌约 3.5 GB（歌声模型整首一次过，随时长增长，靠 10 分钟时长上限兜住）。
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

**英语歌声模型的权重**不会自动下载，要手动放到 `worker/models/checkpoint_MTL`（约 69 MB，已在 `.gitignore` 里，不进仓库）。来源是 [LyricsAlignment-MTL](https://github.com/jhuang448/LyricsAlignment-MTL) 仓库 `checkpoints/checkpoint_MTL`（提交 `dde5139`），放好后核对 sha256：

```bash
mkdir -p worker/models
curl -L -o worker/models/checkpoint_MTL https://github.com/jhuang448/LyricsAlignment-MTL/raw/dde51396875c65fd4fd4cc8f0c523fffec1002be/checkpoints/checkpoint_MTL
shasum -a 256 worker/models/checkpoint_MTL   # 应为 826559e7e810bf8f90223d8fd5c66525c01ad4dd9cdc19d019f39f784e7ed3c1
```

也可以用环境变量 `BIU_SINGING_CHECKPOINT` 指到别的位置。缺这个文件时，只有英语歌会失败（`ALIGN_FAILED`），其他语种不受影响。

**NLTK 词典要预先下好**：英语把单词转成音素用的 g2p_en，第一次 import 时会联网下载 NLTK 的 `cmudict` 和 `averaged_perceptron_tagger`；新版 NLTK 还要 `averaged_perceptron_tagger_eng`，g2p_en 不会自己下，要单独下（合计约 34 MB，存到部署用户的 `~/nltk_data`）。worker 每个任务起一个新进程，不预先下好的话每个英语任务都会去连网，断网时直接失败。装完依赖后用部署用户跑一次：

```bash
venv/bin/python -c "import nltk; nltk.download('averaged_perceptron_tagger_eng', quiet=True)"
venv/bin/python -c "import g2p_en; g2p_en.G2p()('hello')"   # 能打出音素就是装好了
```

MMS_FA 权重是 **CC-BY-NC 4.0**（非商业）。英语歌声模型的代码和权重是 MIT（版权声明见 `worker/singing-LICENSE`），它的训练数据 DALI 是研究用途数据集。Biu 本身非商业可以用；部署方若用于商业用途需另行评估。

## 三种开发方式

真对齐要 Python、约 1.3 GB 模型和每首约 2 分钟 CPU，但大多数开发工作用不到它。按你要改什么选：

| 你要改的 | 用哪种 | 需要 Python / 模型 | 需要 B 站网络 |
| --- | --- | --- | --- |
| 接口、队列、审核流程、错误文案；客户端界面、轮询、预览 | **① mock 模式** | 不需要 | 不需要 |
| 对齐效果本身（`worker/align.py`、判错阈值、清洗规则对结果的影响） | **② 完整本地** | 需要 | 需要 |
| 只改客户端，想看真实对齐效果 | **③ 连已部署的服务** | 不需要 | 需要 |

> 先看清一个前提：**对齐服务只验签 JWT，不管登录**。客户端的 token 来自 `biu-sync-server` 的 `/api/auth/exchange`（用 B 站 cookie 换），所以服务端的 `JWT_SECRET` 必须和签发 token 的那个同步服务一致。本地开发用 `pnpm token` 自己签，就绕开了同步服务；自己部署的做法见下面「首次部署」里的第 6 步。

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

### 让客户端连上本地服务（①② 都要）

服务起来只是一半，桌面客户端还得指过来、并带上测试 token：

1. 设置 → 歌词 → 「歌词对齐服务地址」填 `http://127.0.0.1:3003/api`（端口按 `.env` 的 `PORT`；末尾要带 `/api`；明文 HTTP 只放行回环地址）。这一项只有**桌面端**设置里有，Web 版没有（见下）。
2. 用 `pnpm token <mid>` 签好 token（只看标准输出那一行，下面的提示在标准错误里），启动客户端时带环境变量 `BIU_ALIGN_TOKEN`：

   ```bash
   BIU_ALIGN_TOKEN=<token> pnpm dev          # macOS / Linux，在仓库根目录
   $env:BIU_ALIGN_TOKEN="<token>"; pnpm dev  # Windows PowerShell
   ```

   有这个变量时客户端不去换 token，直接用它；token 默认 12 小时过期，过期后重新签、重启客户端。

3. 客户端界面里仍要先登录 B 站：自动对齐的入口判断的是登录状态，`BIU_ALIGN_TOKEN` 只替换了发请求用的 token。
4. 想测审核员界面：`pnpm token` 用的 mid 要写进服务端 `.env` 的 `ADMIN_MIDS`，改完重启服务。
5. **Web 版**走同源 BFF（`web-server/align-proxy.ts`，路径 `/__biu_align`），token 由 BFF 向 `biu-sync-server`（默认 `127.0.0.1:3002`）换，没有手填 token 的入口。所以本地调 Web 版对齐要连 sync 服务一起起，并用同一个 `JWT_SECRET`；对齐服务地址默认 `127.0.0.1:3003`，可用 `BIU_ALIGN_INTERNAL_ORIGIN` 改。只调界面、不想起 sync 的话，用桌面端更省事。

### ② 完整本地：真实对齐

按上面「Python 环境」装好 venv 和权重，`.env` 里 `PYTHON_BIN` 指向 venv 的 python，然后 `pnpm dev`。macOS 不用装 ffmpeg；Linux / Windows 需要 ffmpeg 在 PATH 里。只想调 `align.py`，不必起服务，直接跑：

```bash
venv/bin/python worker/align.py <音频> <歌词.json> /tmp/out.json /tmp/work
```

每首约 2 分钟。Python 进程峰值约 2.5 GB，开发机内存建议 8 GB 以上。

### ③ 连已部署的服务

客户端设置里的「歌词对齐服务地址」留空（用默认地址）或填已部署实例的 HTTPS 地址（反代把 `/align/*` 转到服务的 `/api/*`，所以地址形如 `https://你的域名/align`），token 走正常登录（客户端用 B 站 cookie 在同步服务 `/api/auth/exchange` 换取）。服务端代码不用在本地跑。注意：

- 用别人部署的实例，会占用部署方的 CPU，你播过的歌还会自动发布给所有人。fork 后长期开发，建议按「部署模型」自己部署一份。
- 只有和部署方同一个 `JWT_SECRET` 签出的 token 才能用。所以 ③ 只能走正常登录，`pnpm token` 签的在那边无效。

## 按语种验证对齐（②的冒烟测试）

四个语种走的是两条路径，装好环境后每种至少跑一首：中日韩用 MMS_FA，英语用歌声模型（要 `worker/models/checkpoint_MTL` 和 NLTK 词典）。准备一首该语种的歌（任意本地音频，不超过 10 分钟）和它的歌词，写成 `歌词.json`（`t` 是原歌词时间的秒数，没有就填 0）：

```json
[
  { "t": 12.3, "text": "第一行歌词" },
  { "t": 16.8, "text": "第二行歌词" }
]
```

```bash
venv/bin/python worker/align.py 歌.m4a 歌词.json /tmp/out.json /tmp/work
python3 -c "import json;d=json.load(open('/tmp/out.json'));print(d['lang'], len(d['lines']), d['offset'])"
```

| 语种 | `lang` 应为 | 判定规则（整首判一次） | 缺了什么会怎样 |
| --- | --- | --- | --- |
| 日语 | `ja` | 假名 ≥ 5 个 | 缺 `unidic-lite` / `fugashi`：日语歌失败，其他不受影响 |
| 韩语 | `ko` | 谚文 ≥ 5 个（且假名 < 5） | 缺 `uroman`：日韩歌失败 |
| 中文 | `zh` | 有汉字（且假名、谚文都不足 5 个） | — |
| 英语 | `en` | 只有拉丁字母，非拉丁字母 < 5 个 | 缺 `checkpoint_MTL` 或 NLTK 词典：英语歌 `ALIGN_FAILED`，其他不受影响 |

`lang` 不对说明歌词被误判（比如日语歌词里假名太少），先看歌词，别急着改算法。成功时 `lines` 行数应等于清洗后的歌词行数；失败时 stderr 最后一行是 `ALIGN_ERROR <代码> <说明>`，代码全表见 `src/lib/errors.ts`。第一次运行会下载约 1.3 GB 模型，先确认磁盘和网络。

## 首次部署（Linux + systemd 示例）

macOS 用 launchd 的注意点见上面「进程优先级」，升级、回滚、红线见 [Web 生产部署与维护指南 §6.1](../docs/web/Web%20生产部署与维护指南.md)。下面是**第一次**从零部署的完整顺序，每步都有可检查的结果。

**机器要求**：2 核以上 CPU（每首约 2 分钟）、内存 ≥ 8 GB（Python 峰值约 2.5 GB，英语歌约 3.5 GB，还要留给系统和同机其他服务）、磁盘 ≥ 5 GB（模型 1.3 GB + 依赖 + 缓存与工作目录）、能访问 B 站（`playurl` 和音频 CDN）。Node 22+、pnpm、Python 3.10+（本仓库开发机为 3.10）、`ffmpeg`（Linux 必需）。

1. **取代码并装依赖**：

   ```bash
   cd biu-align-server
   pnpm install --frozen-lockfile
   pnpm test && pnpm build          # 单测不依赖 Python；build 产出 dist/
   ```

2. **建 Python 环境和模型**：照上面「Python 环境」做完，包括 MMS_FA / Demucs 权重、`worker/models/checkpoint_MTL`（核对 sha256）、NLTK 词典。用**运行服务的那个系统用户**做，因为权重和词典存在该用户的 `~/.cache`、`~/nltk_data` 下。做完跑一次上面「按语种验证」，四种语言都出结果再往下。

3. **写 `.env`**（权限 `600`，放仓库外，别提交）：

   | 变量           | 生产要填的值                                                      |
   | -------------- | ----------------------------------------------------------------- |
   | `PORT`         | `3003`，只监听 127.0.0.1                                          |
   | `JWT_SECRET`   | **和同步服务完全一致**，见第 6 步                                 |
   | `DATA_DIR`     | 持久化目录（缓存、提交、审核记录），有备份；不要放 release 目录里 |
   | `WORK_DIR`     | 临时目录，留空用系统临时目录；任务结束即删                        |
   | `PYTHON_BIN`   | 第 2 步 venv 里 python 的绝对路径                                 |
   | `ADMIN_MIDS`   | 审核员的 B 站 UID，逗号分隔；留空则没人能审核                     |
   | `ALIGN_WORKER` | **不要设**（设成 `mock` 在生产下会拒绝启动）                      |

4. **systemd 单元**（`/etc/systemd/system/biu-align.service`，路径、用户按实际改）：

   ```ini
   [Unit]
   Description=Biu lyrics align server
   After=network.target

   [Service]
   User=biu
   WorkingDirectory=/opt/biu-align-server
   EnvironmentFile=/etc/biu/align.env
   Environment=NODE_ENV=production
   ExecStart=/usr/bin/node dist/index.js
   Restart=on-failure
   Nice=5

   [Install]
   WantedBy=multi-user.target
   ```

   只能起**一个**实例（队列、提交写入的串行化都在进程内）。`sudo systemctl enable --now biu-align`，然后：

   ```bash
   curl -s http://127.0.0.1:3003/api/health   # 应返回 {"ok":true,...}
   journalctl -u biu-align -n 20              # 不应有 [fatal]
   ```

5. **反代**：公网只暴露反代，把 `/align/` 转到服务的 `/api/`。nginx 例：

   ```nginx
   location /align/ {
     proxy_pass http://127.0.0.1:3003/api/;   # 末尾的 / 不能少，用来把 /align/ 换成 /api/
     proxy_read_timeout 30s;
   }
   ```

   验证：`curl https://你的域名/align/health`。限流按登录的 mid 计，不依赖客户端 IP；别给这条路径套额外的限流或缓存（响应本身已是 `no-store`）。

6. **登录（最容易漏的一步）**：客户端的 token 来自**同步服务**，对齐服务只验签，所以：
   - 对齐服务的 `JWT_SECRET` 必须与签发 token 的同步服务（`biu-sync-server`，其 `.env` 同名变量）**逐字符相同**，否则客户端一律 401「登录已过期」。
   - **客户端里同步服务地址是写死的**：桌面端和移动端的 token 换取地址在 `shared/lyrics-align.ts` 的 `ALIGN_TOKEN_EXCHANGE_URL`，同步地址在 `src/service/sync/config.ts` 的 `SYNC_SERVER_BASE_URL`，默认都是官方域名；对齐服务地址则可以在设置里改。fork 后自己部署，只改设置里的对齐地址是不够的：官方同步服务用官方的密钥签 token，你的对齐服务用你的密钥验签，必然 401。要么连同 `biu-sync-server` 一起部署并改这两个常量重新打包客户端，要么让对齐服务用和官方相同的密钥（只有官方部署方能做到，不要向外索取密钥）。
   - Web 版没有这个问题：BFF 在同机用本机的 sync 服务换 token，只要 BFF、sync、对齐三者的 `JWT_SECRET` 一致即可（BFF 用 `BIU_ALIGN_INTERNAL_ORIGIN` / `BIU_SYNC_INTERNAL_ORIGIN` 指向两个本机端口）。

7. **端到端验收**：
   - 客户端登录后播一首歌，等一两分钟（排队 + 约 2 分钟 CPU），歌词变成逐字点亮；自动对齐不弹提示条，只有需要用户处理的失败才露面。`journalctl -u biu-align -f` 能看到任务一行日志。
   - 对同一首歌再放一次，应该秒出（命中缓存，不再排队）。
   - 内存：任务运行时 `top` 里 Python 进程约 2.5 GB，超过机器可用内存会被 OOM 杀掉，表现为 `ALIGN_FAILED`。

**升级**：先 `pnpm test && pnpm build`，新旧两端比对后切换，细节与「客户端改了接口服务端必须同时升级」的红线见上面链接的 §6.1。
