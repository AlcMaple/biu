# Web 部署

> 生产发布、数据备份、自动续期、验证与回滚请先读 [Web 生产部署与维护指南](./Web%20生产部署与维护指南.md)

## 构建与启动

Web 版不是纯静态站点。浏览器、B 站 API 和媒体 CDN 之间必须经过同源 BFF，因此 renderer、登录会话、API 代理和媒体 Range 代理由同一个 Node 进程提供。

```bash
pnpm build:web
pnpm start:web
```

`build:web` 生成：

- `dist/web/`：renderer 静态资源；
- `dist/server/web-server/index.js`：生产服务入口。

`start:web` 默认监听 `127.0.0.1:5678`。健康检查为 `GET /__biu_health`。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BIU_WEB_HOST` | `127.0.0.1` | 监听地址；容器内可显式设为 `0.0.0.0` |
| `BIU_WEB_PORT` | `5678` | 监听端口，范围 1–65535 |
| `BIU_WEB_PUBLIC_ORIGIN` | 本机开发时按连接推导 | 对外完整 origin，例如 `https://music.example.com`；生产或非 loopback 监听时必填 |
| `BIU_WEB_CLIENT_IP_HEADER` | 未启用 | 可信反代覆盖写入的单值客户端 IP header，例如 `X-Biu-Client-IP` |
| `BIU_SYNC_INTERNAL_ORIGIN` | `http://127.0.0.1:3002` | 本机 sync 服务的受信任内部 origin；HTTP 只允许 loopback |
| `BIU_ACME_CHALLENGE_ORIGIN` | 未启用 | 可选的本机 HTTP-01 challenge 服务；只允许 loopback origin |
| `BIU_WEB_CLIENT_LOG_DIR` | 未启用 | 网页端日志落盘目录（相对路径按启动目录解析）。不配置就不接收回传日志 |
| `BIU_WEB_CLIENT_LOG_RETENTION_DAYS` | `7` | 日志保留天数，超期文件自动删除 |
| `BIU_WEB_CLIENT_LOG_MAX_MB` | `200` | 日志目录总体积上限（MB）；保留期内仍超限时从最旧的文件开始删 |

生产示例：

```bash
NODE_ENV=production \
BIU_WEB_PUBLIC_ORIGIN=https://music.example.com \
BIU_SYNC_INTERNAL_ORIGIN=http://127.0.0.1:3002 \
BIU_WEB_CLIENT_LOG_DIR=/var/log/biu-web \
pnpm start:web
```

## 网页端日志回传

手机浏览器打不开开发者工具，用户遇到播放失败只能靠截图描述。配置 `BIU_WEB_CLIENT_LOG_DIR` 后，网页会把 **warn / error** 批量回传到 `POST /__biu_log`，服务端按天写成 NDJSON：

```
/var/log/biu-web/web-client-2026-08-25.log
```

每行一条记录，字段：`receivedAt`（服务端时间，权威）、`clientAt`（客户端时间，仅供参考）、`level`、`message`、`context`、`sessionId`（每个标签页一个随机串，用来把同一次会话串起来，不含账号信息）、`userAgent`、`ip`（仅在配置了 `BIU_WEB_CLIENT_IP_HEADER` 时记录）。

查最近的播放失败：

```bash
grep '"level":"error"' /var/log/biu-web/web-client-*.log | tail -50
```

边界与约束：

- **只接受同源 POST**，单请求体 ≤ 32 KB、单批 ≤ 20 条、单条消息 ≤ 2000 字符；按 IP 60 次/分钟、全局 3000 次/分钟限流，超出返回 429。
- 落盘前统一脱敏：`/__biu_proxy/bilibili/media/<token>` 里的媒体 token、以及 `SESSDATA` / `bili_jct` / `token` 等查询参数都会被替换成 `<redacted>`；控制字符一律剥离，客户端无法伪造额外日志行。
- **磁盘保护是两道闸**：超过保留天数的文件直接删；保留期内总体积仍超 `BIU_WEB_CLIENT_LOG_MAX_MB` 时，从最旧的文件继续删。清理每小时最多跑一次，跟在写入之后，不需要额外的 cron。
- 日志写入是异步的，失败只影响日志本身，不会影响请求与播放。
- info / debug 不回传，只留在浏览器 console。

## HTTPS 反向代理

Web 登录和媒体会话使用 `__Host-`、`Secure`、`HttpOnly` Cookie，公网必须由 HTTPS 反代终止 TLS。BFF 严格比较 `Origin` 的 scheme + host，并且不信任 `X-Forwarded-Host` / `X-Forwarded-Proto`；反代必须把原始 `Host` 原样传给 Node，且与 `BIU_WEB_PUBLIC_ORIGIN` 一致。

Nginx 核心配置示例：

```nginx
location ^~ /__biu_ {
    proxy_pass http://127.0.0.1:5678;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;

    # 必须覆盖而不是追加；并与 BIU_WEB_CLIENT_IP_HEADER 完全一致。
    proxy_set_header X-Biu-Client-IP $remote_addr;

    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;
    proxy_buffering off;
    proxy_read_timeout 1h;

    # API、会话、媒体 token 及 Set-Cookie 响应不得进入反代缓存。
    proxy_no_cache 1;
    proxy_cache_bypass 1;
}

location / {
    proxy_pass http://127.0.0.1:5678;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
}
```

不要配置成“CDN 只托管 `dist/web`、BFF 放在另一个域名”。renderer 请求、登录 Cookie、API 和媒体必须同源。

## 运行边界

- B 站 Cookie、refresh token、Gaia token 都只保存在服务端内存，浏览器只持有本站随机 HttpOnly 标识；上游 `Set-Cookie` 不会回传浏览器。
- Web 同步走同源 `/__biu_sync/*`：BFF 在服务端换取短期同步凭据，浏览器不会取得 B 站 Cookie 或同步 JWT。
- 若配置 `BIU_ACME_CHALLENGE_ORIGIN`，BFF 仅转发合法 HTTP-01 token 到固定 loopback origin，不能成为任意本地 URL 代理。
- 登录会话、匿名媒体会话和不透明媒体 token 都是单进程内存状态。服务重启会退出 Web 登录并使旧媒体 token 失效；当前实现不能直接横向启动多个互不共享状态的 worker。
- 媒体字节经过部署方服务器。播放和拖动会产生 Range 请求，`206`、`Content-Range` 和客户端取消会流式透传，因此带宽与出站流量由部署方承担。
- 媒体端点只接受 BFF 签发的短期不透明 token，不接受 URL 参数；上游目标和每一次重定向都会重新经过固定 UPOS allowlist 校验。
- `/__biu_auth/*`、`/__biu_proxy/*`、`/__biu_sync/*` 和 `/__biu_health` 均不得缓存。普通 HTML 也使用 `no-store`；带内容哈希的静态资源由 Node 返回长期缓存头。
