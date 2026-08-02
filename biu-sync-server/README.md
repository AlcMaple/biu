# biu-sync-server

Biu 本地歌单云同步服务。设计文档：
[`../docs/ideas/004-本地歌单云同步.md`](../docs/ideas/004-本地歌单云同步.md)（先读这个，
了解为什么这么设计、边界情况和部署约束）。

## 这个服务做什么

把 `favorites` / `fav-items` / `tags` 三个本地歌单 JSON store 按 B 站
`mid` 分用户存到服务器磁盘，客户端（Mac / Windows）通过条目级增量操作
（upsert / remove）同步，而不是整文件互相覆盖。

## 部署模型

```
[Electron 客户端 A/B] ──HTTPS──> [Apache 反代] ──> [biu-sync-server :3002（仅监听 127.0.0.1）] ──> [本地磁盘 JSON 文件]
```

**必须单进程部署**（pm2 fork 模式，`instances: 1`）——`src/lib/storage.ts`
里每个 `mid` 的写入互斥队列只在单进程内生效，开 cluster 会让多个子进程
各自维护一份队列，互斥保护失效，可能导致并发写入互相覆盖。

## 接口

### `POST /api/auth/exchange`
用 B 站登录 cookie 换取同步用的短期 token。

```json
{ "cookie": "SESSDATA=...; bili_jct=...; ..." }
```

服务端拿这个 cookie 调 B 站官方 `nav` 接口验证并取得 `mid`（不信任客户端
自报的 mid），返回：

```json
{ "token": "<jwt>", "mid": "123456" }
```

Token 默认 2 小时过期（`JWT_TTL_SECONDS`），过期后客户端用同样的 cookie
重新换发即可，不需要用户感知。

### `GET /api/sync/:store`
`:store` 是 `favorites` | `fav-items` | `tags` 之一。需要 `Authorization:
Bearer <token>`。返回当前快照：

```json
{ "version": 17, "updatedAt": 1735600000000, "data": { "<id>": { "updatedAt": 100, "payload": {...} } } }
```

### `POST /api/sync/:store`
推送本地变更（不是整份数据）：

```json
{
  "baseVersion": 17,
  "ops": [
    { "type": "upsert", "id": "rid-123", "payload": { "...": "..." }, "updatedAt": 1735600001000 },
    { "type": "remove", "id": "rid-456", "updatedAt": 1735600002000 }
  ]
}
```

服务端按条目 id 合并（不是整文件覆盖），同一 id 被两端都改过时按
`updatedAt` 更晚者生效。返回合并后的完整新快照，客户端应该用它覆盖本地
状态并更新自己的 `baseVersion`，保证两端最终收敛一致。合并逻辑见
[`src/lib/merge.ts`](src/lib/merge.ts)，单测见
[`src/lib/__tests__/merge.test.ts`](src/lib/__tests__/merge.test.ts)。

### `GET /api/health`
探活，返回 `{ ok: true, ts: <时间戳> }`。

## 本地开发

```bash
pnpm install
cp .env.example .env
# 填 JWT_SECRET（随便一串随机字符串，例如 openssl rand -hex 32）
pnpm dev
# → [biu-sync-server] listening on http://127.0.0.1:3002
```

```bash
pnpm test        # 跑合并逻辑单测
```

## 生产部署

```bash
pnpm build        # → dist/index.js
pm2 start ecosystem.config.cjs
pm2 install pm2-logrotate    # 必须装，否则 pm2 日志无限增长吃磁盘
```

Apache 侧新增反代（参考 `docs/自动更新部署指南.md` 里已有的静态目录配置
手法，新增一段 `ProxyPass`，不要动原有的 `updates/` 配置）：

```
ProxyPass /biu/sync/ http://127.0.0.1:3002/
ProxyPassReverse /biu/sync/ http://127.0.0.1:3002/
```

### 磁盘 / 内存卫生检查清单

- `DATA_DIR` 里只会有 `{mid}/{store}.json`，没有临时文件残留（写入失败会
  自动清理 `.tmp-*` 文件，见 `storage.ts`）。
- 墓砖（已删除条目标记）每天凌晨 3 点自动清理超过 `TOMBSTONE_RETENTION_DAYS`
  天的记录，避免文件无限增长。
- `pm2-logrotate` 必须装，否则 `pm2 logs` 的原始文件会无限增长。
- `ecosystem.config.cjs` 里的 `max_memory_restart: "150M"` 是硬上限，
  超过说明有内存泄漏，宁可自动重启也不要拖累这台机器上的其他服务。
