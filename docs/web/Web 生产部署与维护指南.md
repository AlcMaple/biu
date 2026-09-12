# Biu Web 生产部署与维护指南

> 域名、主机、账号、私钥位置、数据路径、端口、证书目录和备份位置只存在于受控终端的私有运维配置中

## 0. 使用方式：公开流程 + 私有运行时配置

公开文档必须让接手者知道“做什么、如何验证、何时停止”；私有配置只回答“在哪台机器、哪个路径、用哪个凭据”。二者不可合并。

```text
公开 Git 仓库
  ├─ 本指南：流程、检查项、变量名、回滚原则
  └─ ops/production.example.env：无真实值的字段模板

受控运维终端（不在 Git 中）
  └─ production.env：真实主机别名、路径、服务标签、域名等
```

没有私有配置或对应服务器访问权时，AI/开发者应当**停止**，而不是猜 IP、用户、路径或密钥。

本项目在受控 macOS 终端的默认配置文件约定为 `~/.config/biu/production.env`。它位于仓库之外，权限必须为 `600`；如果换了机器或用户目录，应重新创建同等字段的私有文件，再通过 `BIU_OPS_CONFIG` 指向它。这个文件是部署服务器时使用的运维参数，不是前端或 Web 功能配置。


首次准备本项目环境时可以这样加载（不要把文件内容粘贴到聊天或公开日志）：

```bash
export BIU_OPS_CONFIG="$HOME/.config/biu/production.env"
chmod 600 "$BIU_OPS_CONFIG"
```

普通 Web 更新主要需要公网入口、云主机制品中转和 Mac mini Web 服务的 `BIU_WEB_*` 字段；`BIU_SYNC_DATA_DIR`、备份目录和 `BIU_TEST_ACCOUNT_ID` 只在修改/验收 sync 数据时使用；`BIU_UPDATE_*` 只在发布桌面自动更新时使用；`BIU_ACME_*` / `BIU_CERTBOT_*` 只在证书续期或 HTTP-01 挑战维护时使用。字段的逐项说明和填写来源见 [ops/production.example.env](../../ops/production.example.env)。

### 授权会话的启动方式

在获授权的开发机或 Mac mini 私有终端中，由操作人预先设置 `BIU_OPS_CONFIG` 指向仓库外、权限为 `600` 的私有配置文件。不要在聊天框、终端截图或 GitHub 中粘贴该文件内容。

```bash
: "${BIU_OPS_CONFIG:?需要私有运维配置；未设置时停止}"
test -f "$BIU_OPS_CONFIG"
set -a
. "$BIU_OPS_CONFIG"
set +a

: "${BIU_PUBLIC_ORIGIN:?}"
: "${BIU_CLOUD_SSH_ALIAS:?}"
: "${BIU_CLOUD_ARTIFACT_DIR:?}"
: "${BIU_WEB_RELEASE_ROOT:?}"
: "${BIU_WEB_AGENT_FILE:?}"
: "${BIU_WEB_SERVICE_LABEL:?}"
: "${BIU_WEB_NODE:?}"
: "${BIU_WEB_PORT:?}"
: "${BIU_WEB_TEST_PORT:?}"
: "${BIU_HEALTH_PATH:?}"
: "${BIU_SYNC_INTERNAL_ORIGIN:?}"

# 只有进入第 6 节执行 sync 数据迁移/恢复时才需要：
# : "${BIU_SYNC_DATA_DIR:?}"
# : "${BIU_SYNC_BACKUP_ROOT:?}"
```

只检查变量是否存在，**不要**运行 `env`、`set`、`cat "$BIU_OPS_CONFIG"`、`plutil -p` 或把完整 LaunchAgent 输出写入日志。

字段模板见 [ops/production.example.env](../../ops/production.example.env)。实际 `ops/production.env` 必须被 Git 忽略。

## 0.1 这份文档的可移植性：哪些能照抄，哪些必须自己搞

本文档写的是 Biu Web，但**大部分内容与项目和服务器无关**。换一个项目、换一台服务器时，按下表判断每一节该怎么处理。

| 分类 | 含义 | 对应章节 |
| --- | --- | --- |
| **A 直接照抄** | 与项目、语言、服务器、云厂商都无关，是普适的工程约束 | 0（公私分离）、2（发布前硬停止条件）、5.0（签发失败判据）、5.1（HTTPS 响应头）、7 的回滚原则、8（公开提交前检查） |
| **B 换形态要调整** | 思路通用，但命令取决于你的进程管理器、Web 服务器、构建工具 | 3（构建与发布）、4（分层验收）、5（证书体系）、6（有状态服务与数据迁移） |
| **C 每个环境必须自己填** | 没有通用答案，只能来自你自己的私有配置 | 1（架构边界）、所有 `$BIU_*` 变量的取值 |

### A 类：直接照抄的部分

这几条是本文档真正的价值所在，与技术栈无关：

- **公开流程与私有取值分离**（§0）。公开仓库只写「做什么、如何验证、何时停止」，真实主机/路径/凭据放仓库外的一个 `600` 权限文件，用变量名引用。缺私有配置就**停止**，不要猜。
- **发布前硬停止条件**（§2）。线上跑的功能必须在当前分支有可追溯 commit；备份和回滚点必须在动手前就位。这两条防的是「用缺功能的 checkout 覆盖生产」和「出事了退不回去」。
- **签发失败的判据**（§5.0）。`During secondary validation` 是多视角验证失败的线索，不是排除配置问题的证据；按 §5.0 分层检查。
- **分层验收顺序**（§4）：本机 → 内网 → 公网 → 真实浏览器。跳过任何一层都会出现「本机好好的，用户打不开」。
- **脱敏检查清单**（§8）。

### B 类：换形态要调整的部分

替换成你自己的等价物即可，检查项和顺序不用变：

| 本文用的                  | 你可能用的                                    | 影响的章节 |
| ------------------------- | --------------------------------------------- | ---------- |
| LaunchAgent（macOS）      | systemd unit、supervisor、pm2、Docker Compose | 3.4、5、6  |
| Apache（TLS 终止 + 反代） | Nginx、Caddy、云厂商 LB                       | 3.2、5、7  |
| pnpm + 前端构建           | 任何构建工具                                  | 3.1        |
| 私有隧道（应用在内网）    | 应用与反代同机、K8s Service                   | 1、3.2     |
| Certbot                   | acme.sh、Caddy 自动 TLS、云厂商托管证书       | 5          |

**注意 Caddy / 云厂商托管证书会让 §5 大部分失效**——它们自动续期、自动重载，仍需核对续期归属、告警与实际对外证书，保留 §5.0 的排查思路。

### C 类：必须自己生成的部分（含生成步骤）

**这一类的关键不是「填什么值」，而是「为什么不能照抄」和「怎么正确生成」。** 原理和流程不变，变的只有这些每个环境必须重新产生一次的东西。

按「不能照抄的原因」分成四种，处理方式完全不同：

#### C1 同机唯一：抄了会互相踢

同一台机器上跑第二个项目时，这些值一旦重名，两个服务会互相顶掉，且现象具有欺骗性——服务看起来启动成功，实际是把对方挤下线了。

| 项目 | 冲突后果 | 生成方法 | 冲突检测 |
| --- | --- | --- | --- |
| 应用监听端口 | 后启动的绑定失败并**立即退出**，健康检查却可能命中前一个进程而假通过 | 给每个项目分一段连号区间并记在私有配置里，不要随机挑 | `ss -ltnp \| grep :<端口>` 必须为空 |
| 进程管理器服务标签 | 同名 unit / label 会被 `bootout` / `systemctl stop` 顶掉 | 用 `<反写域名>.<项目>.<角色>` 形式，如 `com.example.web` | `launchctl print gui/$(id -u)/<标签>` 或 `systemctl status <名>` 应报「不存在」 |
| 隧道端口 | 隧道静默连到别的项目的服务上，表现为「访问 A 项目出现 B 项目的页面」 | 与应用端口同段规划 | 同上，且要在**两端**都查 |
| 数据目录 / 备份根目录 | 两个项目写同一份数据，损坏后无法归因 | 目录名带项目名，不要用 `/data`、`/backup` 这类通名 | 目录必须不存在或为空 |
| 反代 vhost 的 ServerName | 请求路由到错误的后端 | 一域名一 vhost 文件 | `apache2ctl -S` / `nginx -T` 里该域名只应出现一次 |

**新环境开工第一步就是把这张表的值定下来并逐项做冲突检测**，不要边部署边挑。

#### C2 一次性签发：只显示一次，丢了只能重新生成

这些东西**没有「查看」入口**，关掉页面就再也看不到，只能作废重发。

| 项目 | 在哪生成 | 注意 |
| --- | --- | --- |
| 云厂商 API 凭据（DNS / 对象存储等） | 厂商控制台的子账号 / Token 页 | **必须建独立子账号并限定到最小权限**，不要用主账号凭据 |
| OAuth 客户端密钥 | 各平台开发者控制台 | 创建弹窗里当场复制 |
| 发信服务的 SMTP 密钥 | 发信服务控制台 | 部分服务的密钥**长期不用会自动过期**，表现为功能突然失效 |
| 服务端会话签名密钥 | 自己生成，如 `openssl rand -base64 48` | 每个环境一把，测试环境的密钥绝不能带上生产 |

统一约束：**全部放在部署目录之外、权限 `600` 的文件里**，用变量名引用。放部署目录里的话，`rm -rf` 重新部署会把它们一起删掉。

#### C3 环境派生：不是「填」出来的，是「跑」出来的

这些值由工具或平台在运行时产生，**手抄前一个环境的值一定是错的**：

- **证书与私钥** —— 由 ACME 客户端签发，见 §5。不要复制别的环境的证书文件。
- **ACME 挑战记录值** —— 每次验证现算，钩子脚本自动写入和清理，不要手工创建 TXT 记录。
- **DNS 认证记录（SPF / DKIM 等）** —— 一律以服务商控制台当场给出的记录为准，不要照抄任何文档里的示例值。
- **构建产物哈希 / 发布目录时间戳** —— 由构建流程产生，用来保证发布包不可变。

#### C4 架构边界表：形态不同就要重画

§1 那张表是按本项目形态写的（Web BFF + 有状态同步服务 + 隧道）。换项目时**这张表要重画，但画表这件事不能省**——它定义了「哪个组件不能做什么」，是后面所有「禁止操作」的依据。

给你自己的每个组件回答两个问题即可：**它对哪份数据有权威性？它绝对不能做什么？**

所有 `$BIU_*` 变量只是命名约定，换项目时整体改前缀，字段含义见 [ops/production.example.env](../../ops/production.example.env)。

### 用这份文档接手一个新环境

1. **先定 C1**：端口段、服务标签、数据目录全部定下来并做冲突检测。这一步没做完不要开始部署
2. **再办 C2**：申请凭据，写进仓库外的 `600` 配置文件，用 §0 的方式加载
3. **画 C4**：写出你自己的架构边界表
4. **签证书**（§5）：**在部署应用之前做**，证书没有的话后面所有公网验收都做不了
5. **换 B 类命令**：按上面的对照表把进程管理器、Web 服务器、构建工具换成你的等价物
6. **A 类原样保留**，一个字都不用改
7. **演练一次回滚和数据恢复**（§6、§7）——不要等真出事才第一次执行

## 1. 必须理解的架构边界

```text
浏览器 → 公网 HTTPS 反代 → 私有 Web 隧道 → Web BFF → 本机 sync 服务 → 同步数据
桌面端 → 既有同步 API 反代 → 私有 sync 隧道 ────────────────┘
```

| 组件 | 职责 | 不能做的事 |
| --- | --- | --- |
| Web BFF | 登录、B 站 API/媒体 Range 代理、固定歌词上游代理、Web 同步桥接 | 不能改为静态站；不能把 Cookie、JWT 或上游签名 URL 交给浏览器 |
| sync 服务 | `favorites`、`fav-items`、`tags` 的条目级合并、历史与通知 | 必须单实例；不能用多进程/cluster 并发写同一数据目录 |
| 浏览器 IndexedDB | 缓存、同步基线、离线辅助 | 不是跨端权威数据源 |
| 公网反代 | TLS、Host 原样传递、Range 透传、到私有隧道的转发 | 不能暴露终端、SSH、数据目录或备份目录 |

本地音乐文件、下载内容、设备设置、窗口状态与 Web 登录会话不属于跨端歌单同步范围。

## 2. 发布前硬停止条件

### 2.1 源码与线上功能一致

任何上线实例特有的 BFF 路由、同步桥接、证书挑战处理或安全修复，都必须存在于当前分支、测试和可追溯 commit 中。禁止从缺少线上功能的 checkout 直接构建覆盖生产。

```bash
git status --short
git rev-parse --short HEAD
pnpm exec vitest run
pnpm build:web
git diff --check
```

若构建失败、相关测试未覆盖、当前分支不明确，或无法证明发布产物与线上功能一致，停止发布。

### 2.2 备份与回滚信息齐全

每次发布前记录：当前 commit、当前 release、私有备份位置、可回滚 release、待修改的 LaunchAgent / 反代文件。

Web-only 更新不应触碰 sync 数据；只备份 Web 服务定义和当前 release 指针。修改 sync 服务、`DATA_DIR`、JSON schema 或同步协议时，必须转到第 6 节执行数据备份和恢复验证。

## 3. 常规 Web 更新流程

### 3.1 本机构建并生成不可变发布包

```bash
pnpm build:web
release_stamp=$(date -u +%Y%m%dT%H%M%SZ)
package_file="/tmp/biu-web-$release_stamp.tar.gz"
tar -C "$PWD" -czf "$package_file" dist/web dist/server
shasum -a 256 "$package_file"
tar -tzf "$package_file" | grep -Ec '\.env$|node_modules|\.pem$|\.key$'   # 必须为 0
```

发布包只包含 `dist/web` 与 `dist/server` 这两个 Web 产物目录。**不要整包 `dist/`**：同一工作区若跑过桌面端打包，`dist/artifacts/` 会留下几百 MB 的 Electron 产物（内含 `node_modules`），既违反下面的禁止项，也会把发布包从不到 1 MB 撑到几十 MB。

发布包严禁包含 `.env`、用户数据、`node_modules`、证书、私钥、浏览器 profile、运维配置或日志。

若 BFF 新增运行时 npm 依赖，不能在活跃 release 目录里盲目执行 `pnpm install`。先在隔离环境验证依赖解析、锁文件和启动方式，再把依赖切换方案写入私有运行手册。

### 3.2 安全传递发布包

使用私有 SSH 别名，不在公开文档中记录 IP、root 账号、密钥文件名或跳板路径。

```bash
ssh "$BIU_CLOUD_SSH_ALIAS" "mkdir -p '$BIU_CLOUD_ARTIFACT_DIR'"
scp "$package_file" "$BIU_CLOUD_SSH_ALIAS:$BIU_CLOUD_ARTIFACT_DIR/$(basename "$package_file")"
ssh "$BIU_CLOUD_SSH_ALIAS" "shasum -a 256 '$BIU_CLOUD_ARTIFACT_DIR/$(basename "$package_file")'"
```

以上远程命令由本地展开路径；路径约定不含单引号或换行，SSH 不会自动传递本地环境变量。跨终端时先加载同一份字段配置，并带入本次 `release_stamp`、包名和预期 SHA-256。

在 Mac mini 私有终端中，下载到临时目录、再次核对 SHA-256，并解包到新的 release 目录；不要覆盖旧 release。

```bash
release_root="$BIU_WEB_RELEASE_ROOT/$release_stamp"
mkdir -p "$release_root/logs"
scp "$BIU_CLOUD_SSH_ALIAS:$BIU_CLOUD_ARTIFACT_DIR/$(basename "$package_file")" /tmp/
shasum -a 256 "/tmp/$(basename "$package_file")"
tar -xzf "/tmp/$(basename "$package_file")" -C "$release_root"
test -f "$release_root/dist/web/index.html"
test -f "$release_root/dist/server/web-server/index.js"
```

哈希不一致或文件缺失时停止，不要继续切换。

### 3.3 隔离试运行

在未使用的 loopback 端口启动新 release；端口、Node 路径、环境变量及静态根目录均从私有配置读取。不要在文档中复制完整生产环境变量。

```bash
set -eu
test_port="$BIU_WEB_TEST_PORT"
if lsof -nP -iTCP:"$test_port" -sTCP:LISTEN; then
  echo '测试端口已占用：核实进程归属后停止本次试运行' >&2
  exit 1
fi
cd "$release_root"
BIU_WEB_HOST=127.0.0.1 \
BIU_WEB_PORT="$test_port" \
BIU_WEB_PUBLIC_ORIGIN="$BIU_PUBLIC_ORIGIN" \
BIU_SYNC_INTERNAL_ORIGIN="$BIU_SYNC_INTERNAL_ORIGIN" \
BIU_ACME_CHALLENGE_ORIGIN="${BIU_ACME_CHALLENGE_ORIGIN:-}" \
BIU_WEB_CLIENT_LOG_DIR= \
"$BIU_WEB_NODE" dist/server/web-server/index.js > logs/test.log 2>&1 &
test_pid=$!
trap 'kill "$test_pid" 2>/dev/null || true; wait "$test_pid" 2>/dev/null || true' EXIT
sleep 2
kill -0 "$test_pid"
curl --max-time 10 -fsS "http://127.0.0.1:$test_port$BIU_HEALTH_PATH"
lsof -a -p "$test_pid" -nP -iTCP:"$test_port" -sTCP:LISTEN
```

在独立 Bash 会话中执行，退出时只清理本次创建的 PID。`lsof` 必须已安装；若进程退出或监听 PID 不符，先读 `logs/test.log`，不要把旧进程的健康响应算作新包通过，更不要批量杀占用端口的未知进程。测试实例禁用回传日志，避免测试流量混入生产日志。

歌词验收同时覆盖 `/__biu_lyrics/netease/search`、`/__biu_lyrics/lrclib/search` 和结果预览；通过真实页面低频操作，确认返回 JSON 与可用结果，不将健康检查等同于上游出站能力正常。

### 3.4 切换 LaunchAgent

只替换 release 路径与日志路径；保留现有的公网 origin、sync 内部 origin、ACME origin 与其他安全环境变量。

```bash
agent_file="$BIU_WEB_AGENT_FILE"
cp "$agent_file" "$agent_file.bak-$release_stamp"
# 清理历史追加的入口参数；前提是此服务只使用 Node + 入口两个参数。
plutil -replace ProgramArguments -json '[]' "$agent_file"
plutil -insert ProgramArguments.0 -string "$BIU_WEB_NODE" "$agent_file"
plutil -insert ProgramArguments.1 -string "$release_root/dist/server/web-server/index.js" "$agent_file"
plutil -replace WorkingDirectory -string "$release_root" "$agent_file"
plutil -replace StandardOutPath -string "$release_root/logs/web.out.log" "$agent_file"
plutil -replace StandardErrorPath -string "$release_root/logs/web.err.log" "$agent_file"
plutil -lint "$agent_file"

launchctl bootout "gui/$(id -u)/$BIU_WEB_SERVICE_LABEL"
sleep 2
launchctl bootstrap "gui/$(id -u)" "$agent_file"
launchctl kickstart -k "gui/$(id -u)/$BIU_WEB_SERVICE_LABEL"
```

若已有额外 Node 参数，先核实用途再整理，不要直接清空。`bootout` 异步卸载，短暂等待不保证成功；若出现 `Bootstrap failed: 5: Input/output error`，先检查服务状态与 plist，确认已卸载后再尝试一次 bootstrap，仍失败则按 §7 恢复备份，禁止无限重试。

回传日志目录应按 §4.1 配在跨 release 的固定目录；只更新该环境字段，不整体替换 `EnvironmentVariables`。

Web BFF 登录会话位于进程内存，重启后用户需要重新登录；这是预期行为，不是歌单数据丢失。

### 3.5 Sentry 监控接入

Web 监控由两个相互独立的 Sentry 项目组成：浏览器 `biu-web` 和 Node BFF `biu-server`。Electron、Android、iOS 不读取 Web 的 DSN。两端均关闭自动 PII；登录态仅主动设置 B 站 `mid` 与昵称，浏览器请求只向同源 `__biu_*` BFF 传播 trace；健康检查、静态资源和网页日志不上报性能 span。

Sentry 配置必须放在仓库外的 `600` 权限文件中。浏览器 DSN 是构建期变量，服务端 DSN 是 LaunchAgent 运行时变量；`SENTRY_RELEASE` 与 `VITE_SENTRY_RELEASE` 必须逐字符相同：

```bash
release=$(git rev-parse --short HEAD)
sentry_env=/仓库外的/biu-sentry.env
test -f "$sentry_env"
chmod 600 "$sentry_env"
set -a
. "$sentry_env"
set +a
SENTRY_RELEASE="$release" VITE_SENTRY_RELEASE="$release" pnpm build:web
```

`SENTRY_AUTH_TOKEN`、`SENTRY_ORG`、`SENTRY_WEB_PROJECT` 同时存在时，Rsbuild 的 Webpack 兼容插件才会上传 `dist/web` 的 source map，并在上传后删除 map；未配置 token 时不生成 Web source map。`web-server` 的 `@sentry/node` 会在 `build:web` 的最后一步打进 `dist/server/web-server/index.js`，因此发布包仍只需要 `dist/web` 和 `dist/server`，不在活跃 release 里执行 `pnpm install`。

LaunchAgent 需要保留以下运行时变量（真实值仍在私有文件或受控 plist 中）：

```text
SENTRY_DSN=<biu-server 项目 DSN>
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=<本次 git 短提交>
SENTRY_TRACES_SAMPLE_RATE=0.05
```

前端构建变量对应 `VITE_SENTRY_DSN`、`VITE_SENTRY_ENVIRONMENT`、`VITE_SENTRY_RELEASE` 和 `VITE_SENTRY_TRACES_SAMPLE_RATE`。没有 DSN 时浏览器监控模块不会加载；监控初始化失败也不能阻断页面启动。

首次验收使用**现有已登录的 Chrome 标签**打开站点，不要新建会话导致重新登录。确认 `window.__biuMonitoring` 已初始化并完成用户信息刷新后，再从真实业务代码触发一次受控错误，检查 `biu-web` 项目的 issue 是否带当前 release、用户 `id` / `username`、browser/os/device 上下文且 URL 无 query；匿名事件的用户字段为空是预期行为。服务端真实 500 应进入 `biu-server`，带已校验账号的 `id` / `username` 和同一个 `X-Request-ID`。公网静态资源的 `.map` 后缀不得返回 source map。

## 4. 发布后的逐层验收

按从内到外顺序执行；每层失败先修复该层，不要盲目改 DNS、TLS 或数据。

```bash
# Mac mini 本机
curl -fsS "http://127.0.0.1:$BIU_WEB_PORT$BIU_HEALTH_PATH"
launchctl print "gui/$(id -u)/$BIU_WEB_SERVICE_LABEL" | grep -E 'state =|last exit code'

# 公网，不输出认证信息
curl -sS -o /dev/null -w 'site=%{http_code} http=%{http_version} tls=%{ssl_verify_result}\n' "$BIU_PUBLIC_ORIGIN/"
curl -sS -o /dev/null -w 'health=%{http_code}\n' "$BIU_PUBLIC_ORIGIN$BIU_HEALTH_PATH"
```

云反代主机还需检查其 loopback 隧道端点（从私有拓扑读取），确认请求到达本次 Web 实例；本机正常而这层失败时先查隧道，不直接重签证书。

再用真实浏览器完成：登录、歌单读取、播放、拖动进度。媒体 Range 必须真实得到 `206` / `Content-Range`，不能只凭首页 `200` 判定发布成功。

对跨端歌单，使用受控测试账号验证新增、修改、删除、离线恢复和同条目冲突；正常在线时通过通知通道在亚秒到数秒级收敛，离线/休眠设备在恢复后拉取并最终一致。

### 4.1 日常维护：网页回传日志

BFF 只有配置 `BIU_WEB_CLIENT_LOG_DIR` 才启用持久化回传日志；默认关闭。将其设置为 release 外的受限绝对目录，授予 Web 服务用户写入权限，切换版本时保留该环境变量。字段模板见 `ops/production.example.env`，配置依据为 `web-server/index.ts` 与 `web-server/client-log-store.ts`。

```bash
: "${BIU_WEB_CLIENT_LOG_DIR:?需要先启用回传日志}"
ls -lh "$BIU_WEB_CLIENT_LOG_DIR"
tail -n 100 "$BIU_WEB_CLIENT_LOG_DIR/web-client-$(date -u +%Y-%m-%d).log"
grep '"level":"error"' "$BIU_WEB_CLIENT_LOG_DIR"/web-client-*.log | tail -n 50
```

这些命令只在私有终端运行。每天一个 NDJSON 文件，以 `receivedAt` 为服务端时间，另有 `clientAt`、`level`、`message`、`context`、`sessionId`、`ip`、`userAgent`。`sessionId` 是标签页会话标识，不是可信账号 ID；日志含 IP 等元数据，即便消息中的敏感串已脱敏，也不要公开原始日志。请求返回 `202` 仅表示接收，不代表异步落盘成功，验收需核对实际文件。

默认保留 7 天、总容量目标 200 MiB（配置字段单位名为 MB）；可用 `BIU_WEB_CLIENT_LOG_RETENTION_DAYS`、`BIU_WEB_CLIENT_LOG_MAX_MB` 调整。清理随日志写入按间隔触发，不是到点立即执行的定时删除，也不是磁盘硬配额；无需重复加清理 cron，仍需监测权限和磁盘空间。排查播放问题先按服务端时间与会话串关联，再结合进程日志和 Sentry；回传受限流与网络影响，不承诺覆盖所有错误。

## 5. 证书与自动续期

证书以实际 `notAfter` 为准，不把历史有效期或固定续期窗口写成长期保证。

**同一台反代主机上可能并存多套互不相干的签发体系**，动手前先确认当前域名属于哪一套，否则会照着错的那套排查很久。常见两种形态：

- **挑战回落到内网服务**：证书由内网主机上的 Certbot 签发，公网反代把挑战路径转发到固定的 loopback 端口。这种形态下挑战路径只能转发到那个固定服务，**不能成为任意本地 URL 代理**。
- **反代主机本机签发**：Certbot 直接在反代主机上以 Web 服务器插件完成验证，**没有挑战反代**。这种域名的 vhost 里不应出现挑战转发配置；从前一种形态的 vhost 复制配置是常见错误。

判断当前域名归哪套管，要同时核对 TLS 实际证书路径、签发机的 renewal 配置和调度任务。反代主机没有 renewal 配置，也可能是外部 DNS-01 签发后复制或托管证书，不足以证明存在 HTTP 挑战反代。

私有配置应提供两套体系各自的 Certbot 二进制、配置目录、工作目录、日志目录、续期任务标签和挑战路径。状态检查与测试续期示例（dry-run 会连接 ACME 测试服务并执行验证，不是纯只读）：

```bash
launchctl print "gui/$(id -u)/$BIU_ACME_SERVICE_LABEL" | grep -E 'state =|last exit code|path ='
"$BIU_CERTBOT_BIN" renew --dry-run \
  --config-dir "$BIU_CERTBOT_CONFIG_DIR" \
  --work-dir "$BIU_CERTBOT_WORK_DIR" \
  --logs-dir "$BIU_CERTBOT_LOG_DIR"
```

干跑使用测试证书；不得在干跑中触发会将测试证书复制到生产 TLS 终止服务的 deploy hook。真实续期 hook 应在复制后先验证反代配置，再 reload 服务。

**续期后必须重载 TLS 终止服务**，否则新证书要等下次重启才生效。用 deploy hook 统一处理，不要逐个域名手工重载；确认 hook 目录非空是一次性的例行检查。

### 5.0 给新域名签发失败时

如果反复失败、且错误信息**每次都不一样**（DNS SERVFAIL、CAA 查询失败、DNSSEC 异常、挑战路径连接超时轮流出现），先看错误里有没有 `During secondary validation`。

这只能说明某个二次验证视角失败，不能排除权威 DNS、CAA、DNSSEC、AAAA 指向、区域防火墙或挑战路径配置问题。先从独立网络核对 DNS 与 HTTP-01 路径；主验证通过不代表其他位置必然可达。不要未定位就改 vhost 或照抄其他域名的挑战反代。

HTTP 可达性不稳定、通配符证书或不开放 80 端口时，可以采用 DNS-01；DNS 自身故障仍须修复。优先按当前安装方式选兼容的 DNS 插件，不将系统包管理器与随意 pip 安装混用。手工模式要有自动 auth/cleanup hook 才能无人值守续期。依据：[Let's Encrypt 挑战类型](https://letsencrypt.org/docs/challenge-types/)、[Certbot 用户指南](https://eff-certbot.readthedocs.io/en/stable/using.html)。

### 5.1 HTTPS 响应头基线

发布后在公网检查安全响应头。`nosniff` 与严格的 `Referrer-Policy` 是最低要求；HSTS、反嵌入和 CSP 需要先在测试环境验证，不能为了“补头”而破坏登录、媒体或第三方 API。

```bash
curl -sSI "$BIU_PUBLIC_ORIGIN/" | grep -Ei '^(strict-transport-security|content-security-policy|x-frame-options|x-content-type-options|referrer-policy|permissions-policy):'
```

- HSTS 仅在该域名长期稳定使用 HTTPS 后启用；不要未经审计加入 `includeSubDomains` 或 `preload`。
- 用 `Content-Security-Policy-Report-Only` 观察真实页面依赖后，再收紧为执行策略。
- 反嵌入应通过 CSP `frame-ancestors` 或等效响应头完成，并在登录页和播放器页实际验证。

### 5.2 DNS-01 签发与续期接管

以下在**签发机**执行；新增 `BIU_TLS_DOMAIN`、`BIU_TLS_CERT_NAME`、`BIU_DNS_AUTH_HOOK`、`BIU_DNS_CLEANUP_HOOK` 由私有配置填写。hook 路径及参数作为完整字符串配置；DNS 凭据由脚本从受限文件读取，不写入命令行。首次使用先按当前 Certbot 版本准备账户注册信息。

```bash
"$BIU_CERTBOT_BIN" certonly --manual --preferred-challenges dns \
  --cert-name "$BIU_TLS_CERT_NAME" -d "$BIU_TLS_DOMAIN" \
  --manual-auth-hook "$BIU_DNS_AUTH_HOOK" \
  --manual-cleanup-hook "$BIU_DNS_CLEANUP_HOOK" \
  --config-dir "$BIU_CERTBOT_CONFIG_DIR" \
  --work-dir "$BIU_CERTBOT_WORK_DIR" \
  --logs-dir "$BIU_CERTBOT_LOG_DIR"
```

签发不等于安装或自动续期完成。hook 应只创建本次验证 TXT，等传播后返回，清理时只删除本次记录；API 权限限于所需区域的 DNS 修改，不使用主账号密钥。

签发机可与 Web 主机分离；复制证书不会把接收机自动纳入 Certbot 管理。必须明确负责续期的机器、调度器、renewal 配置、证书传输与 TLS reload hook，并验证整条链路。可由签发机通过受限 SSH 调用 DNS hook，避免把 DNS 凭据复制到临时机器。

```bash
test -f "$BIU_CERTBOT_CONFIG_DIR/renewal/$BIU_TLS_CERT_NAME.conf"
"$BIU_CERTBOT_BIN" renew --cert-name "$BIU_TLS_CERT_NAME" --dry-run \
  --config-dir "$BIU_CERTBOT_CONFIG_DIR" \
  --work-dir "$BIU_CERTBOT_WORK_DIR" \
  --logs-dir "$BIU_CERTBOT_LOG_DIR"
curl --max-time 15 -sS -o /dev/null -w 'http=%{http_code} verify=%{ssl_verify_result}\n' "https://$BIU_TLS_DOMAIN/"
```

验收还包括调度器已启用、失败告警、实际对外证书的签发者/到期日。正常 TLS 校验禁止加 `-k`，再用未手工信任旧证书的独立设备验证。没有续期归属就记录为未接管并安排处理，不凭复制文件或一次 dry-run 宣称全自动；已有 HTTP-01 证书不必批量迁移，但续期失败应告警处理，不假设重试总能成功。

## 6. 修改 sync 服务或迁移数据

这是高风险操作，不是普通 Web 发布。修改 sync 二进制、`DATA_DIR`、JSON schema、合并逻辑或同步协议时：

1. 读取私有配置中的 `BIU_SYNC_DATA_DIR`，做带时间戳副本与 SHA-256 清单。
2. 在隔离副本核对每个账号 / store 的版本、活条目、墓碑和历史文件数；不要打印条目 payload。
3. 使用独立测试数据、测试账号、测试端口先验证迁移。
4. 明确旧服务、旧数据目录和反代的回滚点后，才切换 sync LaunchAgent。
5. 验证 sync 本机健康检查、私有隧道、既有桌面 API、Web BFF 和真实三端同步。

数据异常时：停止新写入、保留现场、做副本、比较版本与历史。不要手改 JSON、删除墓碑、全量上传空快照或用浏览器缓存覆盖服务器数据。

## 7. 事故与回滚

| 现象 | 首先检查 | 禁止操作 |
| --- | --- | --- |
| 公网 `502` | Web 本机健康检查、服务状态、Web 隧道、反代 | 先改 DNS、重签证书或重启 sync |
| 桌面同步失败 | sync 本机健康检查、sync 隧道、既有同步 API | 新建第二份数据目录或从 Web release 找数据 |
| Web 登录后歌单不同步 | 登录状态、同步桥接、通知通道、源码一致性 | 导出 Cookie/JWT 到前端、覆盖服务器 JSON |
| 证书续期失败 | 先确认域名归哪套签发体系、再看对应 ACME 日志与续期任务状态 | 删除旧证书、暴露终端/SSH、部署测试证书 |
| 新域名签发失败 | 核对 DNS、多视角可达性和挑战方式，见 5.0 / 5.2 | 未定位就改配置、从别的域名复制挑战反代 |
| 数据不一致 | 冻结写入、备份、版本/历史比较 | 手改数据、删历史、全量重新上传 |

Web 回滚：保留新 release，恢复发布前保存的 LaunchAgent 或把路径指回已验证 release，语法检查后重新加载服务，再完成本机、外网和真实浏览器验收。

sync 回滚：只从已验证恢复副本切回旧数据目录/旧发布；先比较统计和哈希，后恢复流量。

反代回滚：从私有备份恢复 vhost，先执行配置语法检查，再 reload，最后外网验证。

## 8. 公开提交前检查

公开提交前必须确认文档与新增文件不含：真实 IP、域名、用户名、账号 ID、内部端口、绝对个人路径、SSH key 文件名、证书路径、备份位置、Cookie/JWT/AccessKey、日志片段或完整配置。

```bash
git diff --check
git diff --cached -- .
git grep -Il -E -e 'BEGIN [A-Z ]*PRIVATE KEY' -e 'AKIA[0-9A-Z]{16}' -e 'SESSDATA=[^[:space:]]{12,}' -- . || true
```

当前文件被清理并不等于历史已清理。首次将既有仓库公开前，必须在**所有 Git refs**上运行本地秘密扫描；一旦命中真实个人标识、凭据或私有基础设施信息，停止推送。若仓库尚未公开，优先创建不带旧历史的新公开仓库；若必须保留历史，先做完整备份并在获授权后使用专门的历史清理工具重写，再 force-push。

公开文档可说明安全边界和变量名；私有配置、SSH 映射、真实基础设施清单及任何恢复副本路径必须留在访问受限的位置。

## 9. 移植到纯静态站：另一条部署路径

**本节用于复用运维流程到其他项目，不用于 Biu Web。** Biu 的登录、媒体代理和同步依赖 Node BFF，仍须同时发布 `dist/web` 与 `dist/server`。

| 判断 | 部署路径 |
| --- | --- |
| 需要维护 Node / Python 等常驻应用进程 | 进程管理器 + 反代，应用在内网时才需要隧道 |
| 构建后只有 HTML / CSS / JS / 图片，无自管服务进程 | 公网 Web 服务器直接读构建产物，无需新建内网进程与隧道 |

不能只凭 Vite / Astro 等工具名称判定；要看是否包含 SSR、服务端接口和运行时密钥。浏览器调用第三方公开 API 不自动等于要部署自管后端。仅上传已审查的构建产物，源码与构建工具不必留在静态服务器。

### 9.1 DNS 与 TLS 准备

- A / AAAA 必须指向实际提供服务的入口。开发机开启 TUN / DNS 劫持时，`dig` 甚至指定权威 NS 的查询都可能被拦截；看到 fake-IP 不应立即判定权威记录错误。到独立服务器查询，或通过可信 DoH 交叉核对；只有可信权威响应才能据以判断 NXDOMAIN。
- 示例 `portal.team.example.com` 在 `example.com` 区域中的主机记录为 `portal.team`，不是完整域名重复拼接。
- 证书按 §5.2 或该环境已验证的 HTTP-01 流程签发。静态站不需要照搬内网挑战反代；使用 webroot HTTP-01 时要单独保留挑战目录的可访问性。
- 配置前备份 HTTP / HTTPS vhost。首次启用需要配置检查、启用站点并 reload；后续仅切换产物软链通常无需 reload。

### 9.2 构建、传包与不可变 release

下面的 `STATIC_BUILD_DIR`、`STATIC_PACKAGE`、`STATIC_RELEASE_ID`、`STATIC_ROOT`、`STATIC_PREVIOUS_RELEASE` 都是**本节临时运维变量**，不是 Biu 应用配置；值由该静态项目的私有运行手册提供。服务器示例针对 Linux / GNU 工具，路径禁止单引号和换行，release ID 限字母数字、点、下划线及连字符。

开发机按该项目锁文件安装并构建，确认产物目录不含 `.env`、源码、日志、source map、私钥或用户数据后：

```bash
: "${STATIC_BUILD_DIR:?}" "${STATIC_RELEASE_ID:?}" "${STATIC_PACKAGE:?}"
test -f "$STATIC_BUILD_DIR/index.html"
tar -C "$STATIC_BUILD_DIR" -czf "$STATIC_PACKAGE" .
shasum -a 256 "$STATIC_PACKAGE"
scp "$STATIC_PACKAGE" "$BIU_CLOUD_SSH_ALIAS:$BIU_CLOUD_ARTIFACT_DIR/"
```

服务器加载自己的私有配置，将 `STATIC_PACKAGE` 设为服务器上的接收包路径；核对开发机与服务器 SHA-256 一致，再确认归档条目无绝对路径、`..` 越界或外部软链。不要解包来路不明的归档。

```bash
set -eu
: "${STATIC_ROOT:?}" "${STATIC_RELEASE_ID:?}" "${STATIC_PACKAGE:?}"
sha256sum "$STATIC_PACKAGE"
release="$STATIC_ROOT/releases/$STATIC_RELEASE_ID"
test ! -e "$release"
mkdir -p "$release"
tar -xzf "$STATIC_PACKAGE" -C "$release"
test -f "$release/index.html"
find "$release" -type d -exec chmod 755 {} \;
find "$release" -type f -exec chmod 644 {} \;
# 现有站点发布前，将此输出记到私有发布记录；首次部署没有 previous。
if test -L "$STATIC_ROOT/current"; then readlink "$STATIC_ROOT/current"; fi
# 临时链接与 current 位于同一文件系统；GNU mv -T 原子替换链接本身。
next="$STATIC_ROOT/.next-$STATIC_RELEASE_ID"
test ! -e "$next" && test ! -L "$next"
ln -s "$release" "$next"
mv -Tf "$next" "$STATIC_ROOT/current"
```

由发布用户管理文件，Web 服务用户只需读权限；不必赋予 Web 进程修改所有产物的权限。首次部署确认父目录可遍历；`current` 必须是软链而非真实目录。保留旧 release，清理前核对当前与回滚点。

### 9.3 Apache 配置与缓存

以下是 HTTPS vhost **内部片段**，不是完整站点配置；将示例路径替换为该站点根目录，补齐 `ServerName`、TLS 证书配置与模块启用。纯静态站不配置应用 `ProxyPass`；HTTP vhost 重定向到 HTTPS，使用 HTTP-01 时保留正确挑战处理。

```apache
DocumentRoot /var/www/example-static/current
<Directory /var/www/example-static/current>
    Options -Indexes +FollowSymLinks
    AllowOverride None
    Require all granted
</Directory>
AddType image/webp .webp
<IfModule mod_headers.c>
    <FilesMatch "\.(js|css|woff2?|webp|jpe?g|png|svg|ico)$">
        Header set Cache-Control "public, max-age=86400"
    </FilesMatch>
    <FilesMatch "^index\.html$">
        Header set Cache-Control "no-cache, must-revalidate"
    </FilesMatch>
    Header always set X-Content-Type-Options "nosniff"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>
```

只有确定文件名包含**内容哈希且永不覆盖同名文件**时，才对那些文件单独配置一年 `immutable` 缓存；不要按 `.js` / `.css` 扩展名一刀切。未哈希图片短缓存，HTML 必须重新验证；如需立即换图，应变更 URL。HSTS 与反嵌入按 §5.1 评估后加。缺失资源应返回真实 404，SPA 回退只覆盖业务路由，不能让 `.env`、README 或缺失图片回退成首页 200。

配置变更后在服务器执行 `apache2ctl -t`，通过才 `systemctl reload apache2`；失败先恢复 vhost 备份再检查。图片在构建前按实际展示尺寸压缩，文字截图可比较 WebP 效果，不将原始大图和归档目录直接发布。

### 9.4 验收与回滚

`STATIC_ORIGIN` 是该静态站的 HTTPS origin，`STATIC_WEBP_PATH` 是本次实际发布的图片路径；另外手动检查 HTTP 入口跳转到 HTTPS。

```bash
curl --max-time 15 -sS -o /dev/null -w 'http=%{http_code} verify=%{ssl_verify_result}\n' "$STATIC_ORIGIN/"
curl --max-time 15 -sSI "$STATIC_ORIGIN/index.html"
curl --max-time 15 -sSI "$STATIC_ORIGIN/$STATIC_WEBP_PATH"
curl --max-time 15 -sS -o /dev/null -w '%{http_code}\n' "$STATIC_ORIGIN/README.md"
curl --max-time 15 -sS -o /dev/null -w '%{http_code}\n' "$STATIC_ORIGIN/.env"
```

分别确认首页 200 且 TLS 校验为 0、入口非长期缓存、图片 `image/webp`、未发布文件 404（或明确的 403）；真实浏览器再看图片、内部路由、刷新与移动端加载。首页 200 不是完整验收。

回滚在服务器执行，把 `STATIC_PREVIOUS_RELEASE` 设为发布前记录且仍完整保留的 release 绝对路径：

```bash
set -eu
: "${STATIC_ROOT:?}" "${STATIC_PREVIOUS_RELEASE:?}"
test -f "$STATIC_PREVIOUS_RELEASE/index.html"
rollback_link="$STATIC_ROOT/.rollback-$(date -u +%Y%m%dT%H%M%SZ)"
ln -s "$STATIC_PREVIOUS_RELEASE" "$rollback_link"
mv -Tf "$rollback_link" "$STATIC_ROOT/current"
```

回滚后重复上述验收，不覆盖或删除失败 release。软链切换只恢复服务器文件，已被浏览器强缓存的同名资源不会自动失效；这也是长期缓存必须配合内容哈希的原因。

## 10. 可选：接入自有运维状态面板

私有环境可能有 `mstatus` 一类脚本，**仓库未提供该脚本及其辅助函数**。先在目标机器读取现有实现，按其契约修改；不要把某台机器已安装当成公共部署前置条件。非交互 SSH 的 PATH 可能不含用户 `bin`，使用私有配置中记录的绝对路径。

| 目标 | 面板应该展示 | 不该推断 |
| --- | --- | --- |
| 常驻应用 / 隧道 | 实际服务标签或容器的运行状态 | 进程存在就等于公网可用 |
| 纯静态站 | 限时 HTTP 探测的状态码与耗时 | 本机没有 LaunchAgent 就是服务故障 |
| 定时任务 | 调度器是否加载、上次结果、执行机器 | 当前没运行就是正常，或就是故障 |
| 未自动接管的证书 | 到期日、剩余天数、续期负责人 | 复制证书后会自动续期 |

如果已有 `dot` / `container_dot` / `site_row`，确认前两者是返回圆点供调用方拼行，还是整行输出；`site_row` 若自己打印整行就直接调用，不再包 `echo`。建议 HTTP 探测带 `curl --max-time 6`，时间上限属于面板策略，不是可用性保证。常规证书可在独立告警系统监测，面板是否显示另行选择。

修改面板前备份；仅当脚本确认为 Bash 时执行 `bash -n "$STATUS_SCRIPT"`，通过后运行 `"$STATUS_SCRIPT"` 核对正常、超时与故障展示。失败恢复备份后再次语法检查。定时任务文字清单不会自动同步，新增、迁移、撤销任务时必须同步，并注明执行机器，避免显示已经撤掉的任务。


### 10.1 Biu 项目块

在已定义 `dot` 的私有 `mstatus` 中加入以下项目块，标签以目标机器实际 LaunchAgent 为准。Web 和云同步使用独立服务与隧道，分开显示才能定位哪条链路异常；不要因某项异常一并重启其他服务。

```bash
echo
echo -e "${BOLD}【Biu 音乐】${RESET}  Web / 桌面云同步"
echo -e "  $(dot com.biu.web)  Web 服务  com.biu.web"
echo -e "  $(dot com.biu.web.tunnel)  Web 隧道  com.biu.web.tunnel"
echo -e "  $(dot com.biu.sync)  云同步服务  com.biu.sync"
echo -e "  $(dot com.biu.sync.tunnel)  云同步隧道  com.biu.sync.tunnel"
```

现有 `dot` 的显示约定：`running` 为绿色实心圆，查询不到状态为空心圆，其他状态为红色实心圆并附状态文字。这四项都是常驻服务，空心圆需要排查，不能套用定时任务的“平时没运行正常”解释。绿色只代表进程运行，不证明隧道远端转发、公网访问或真实播放正常，业务验收仍按 §4 执行。

本块不添加新的轮询、定时任务或服务重启命令，也不把证书续期任务伪装成常驻服务。修改后先对候选副本执行 `bash -n` 并运行核对，保留原脚本与权限，再替换；回滚时恢复备份并重复语法与面板检查。真实主机、脚本备份路径及完整面板输出留在私有运维记录中。
