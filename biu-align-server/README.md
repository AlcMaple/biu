# biu-align-server

Biu 歌词时间轴对齐服务：客户端给出投稿（bvid + cid）和歌词，服务端自己拉 B 站音频，Demucs 分离人声后强制对齐，返回每行、每字的时间；支持中文、日语、韩语、英语，结果按「投稿 + 歌词」缓存、所有人共享。算法依据见 [`docs/lyrics/`](../docs/lyrics/) 和 [`docs/ideas/002-歌词时间轴对齐.md`](../docs/ideas/002-歌词时间轴对齐.md)。

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

## 开发

依赖在仓库根目录统一安装（pnpm workspace，三个服务和客户端共用一个 `node_modules` 与一份 `pnpm-lock.yaml`），**不要**在 `biu-align-server/` 里再装一次。

```bash
# 仓库根目录
pnpm install
cd biu-align-server
cp .env.example .env     # 改 JWT_SECRET（随便一串）、DATA_DIR（本机可写目录，如 ./.data）
pnpm test
```

| 要改什么 | 用哪种 | 需要 Python / 模型 |
| --- | --- | --- |
| 接口、队列、审核、文案；客户端界面 | ① mock | 不需要 |
| 对齐效果（`worker/align.py` 等） | ② 真实对齐 | 需要 |
| 只改客户端、想看真实效果 | ③ 连已部署的服务 | 不需要 |

### ① mock

```bash
pnpm dev:mock
pnpm token 123456        # 签测试 token；要测审核员，先把 123456 加进 .env 的 ADMIN_MIDS 并重启
```

假结果约 3 秒返回，不访问 B 站、不跑 Python，结果存在 `DATA_DIR/alignments/mock/`；生产环境拒绝启动。

### ② 真实对齐

先按上面「Python 环境」装好 venv 和权重，`.env` 里把 `PYTHON_BIN` 改成 `venv/bin/python` 的路径（Linux / Windows 另需 ffmpeg 在 PATH）。

```bash
pnpm dev
```

只调 `align.py` 不用起服务：

```bash
venv/bin/python worker/align.py <音频> <歌词.json> /tmp/out.json /tmp/work
```

### 让桌面客户端连本地服务（①② 通用）

1. 设置 → 歌词 →「歌词对齐服务地址」填 `http://127.0.0.1:3003/api`（端口同 `.env` 的 `PORT`，末尾带 `/api`）。
2. 用上面签的 token 启动客户端（仓库根目录；token 12 小时过期）：

   ```bash
   BIU_ALIGN_TOKEN=<token> pnpm dev                  # macOS / Linux
   $env:BIU_ALIGN_TOKEN="<token>"; pnpm dev          # Windows PowerShell
   ```

3. 客户端里仍要登录 B 站。Web 版没有手填 token 的入口，调对齐请用桌面端。

### ③ 连已部署的服务

设置里「歌词对齐服务地址」留空即用默认地址，正常登录即可，本地不用跑服务端。会占用部署方 CPU，别长期这样开发。

## 按语种验证（②的冒烟测试）

每个语种跑一首（歌 ≤ 10 分钟），`歌词.json`：

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

`lang` 应为 `zh` / `ja` / `ko` / `en`；`lines` 等于歌词行数。失败时看 stderr 最后一行 `ALIGN_ERROR <代码>`，英语歌失败先查 `worker/models/checkpoint_MTL` 和 NLTK 词典是否已装。

## 部署（Linux + systemd）

> **填词歌画面识别只在 macOS 上可用**：它用系统自带的文字识别，部署前在 macOS 上执行 `pnpm --filter biu-align-server build:ocr` 编出 `worker/bin/ocr` 并随 release 一起拷贝；Python 环境需要已列在 `worker/requirements.txt` 里的 pypinyin。Linux 部署时这项功能直接报「不支持」，其余功能不受影响。

机器：2 核、内存 ≥ 8 GB、磁盘 ≥ 5 GB、能访问 B 站，装好 Node 22+、pnpm、Python 3.10+、ffmpeg。升级与回滚见 [Web 生产部署与维护指南 §6.1](../docs/web/Web%20生产部署与维护指南.md)。

**1. 代码与依赖**（`--ignore-scripts` 跳过客户端的 Electron 下载）

```bash
git clone https://github.com/AlcMaple/biu.git /opt/biu && cd /opt/biu
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter biu-align-server test
pnpm --filter biu-align-server build
```

**2. Python 环境和模型**：用运行服务的用户，按上面「Python 环境」做完，再跑一遍「按语种验证」。

**3. 配置** `/etc/biu/align.env`（`chmod 600`，改带 `<>` 的）：

```ini
PORT=3003
JWT_SECRET=<和 biu-sync-server 的 JWT_SECRET 逐字符相同>
DATA_DIR=/var/lib/biu-align
PYTHON_BIN=/opt/biu/biu-align-server/venv/bin/python
ADMIN_MIDS=<审核员 B 站 UID，逗号分隔>
```

**4. systemd** `/etc/systemd/system/biu-align.service`（只能起一个实例）：

```ini
[Unit]
Description=Biu lyrics align server
After=network.target

[Service]
User=biu
WorkingDirectory=/opt/biu/biu-align-server
EnvironmentFile=/etc/biu/align.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
Nice=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now biu-align
curl -s http://127.0.0.1:3003/api/health     # 应返回 {"ok":true,...}
```

**5. nginx 反代**（末尾的 `/` 不能少）：

```nginx
location /align/ {
  proxy_pass http://127.0.0.1:3003/api/;
  proxy_read_timeout 30s;
}
```

```bash
curl https://<你的域名>/align/health
```

**6. 登录（最容易漏）**：客户端 token 由 `biu-sync-server` 签发，对齐服务只验签。

- 两边 `JWT_SECRET` 必须一致，否则一律 401。
- 桌面 / 移动端写死了官方同步服务地址（`shared/lyrics-align.ts` 的 `ALIGN_TOKEN_EXCHANGE_URL`、`src/service/sync/config.ts` 的 `SYNC_SERVER_BASE_URL`）。fork 自部署要连同 `biu-sync-server` 一起部署、改这两个常量并重新打包客户端，只改设置里的对齐地址会 401。
- Web 版：BFF、sync、对齐三者 `JWT_SECRET` 一致即可。

**7. 验收**：客户端登录后播一首歌，一两分钟后歌词变逐字点亮；同一首再播应秒出。日志：`journalctl -u biu-align -f`；Python 峰值约 2.5 GB 内存，不够会 `ALIGN_FAILED`。
