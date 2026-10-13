#!/usr/bin/env bash
# Biu Web 一键发布模板：构建 → 上传云主机 → Web 主机解包/试运行/切换 → 公网验收
# 用法（在仓库根目录）：BIU_OPS_CONFIG=~/.config/biu/production.env ops/deploy-web.example.sh
# 前置：BIU_OPS_CONFIG 指向仓库外的私有配置（字段见 ops/production.example.env）；
#       开发机已免密 SSH 到 BIU_CLOUD_SSH_ALIAS 与 BIU_WEB_SSH_ALIAS，且 Web 主机能免密 scp 云主机。
# 该脚本只替换 Web 服务；不会碰 sync、隧道、证书。失败即停，不会切换正式服务。
set -euo pipefail

: "${BIU_OPS_CONFIG:?需要私有运维配置；未设置时停止}"
set -a
. "$BIU_OPS_CONFIG"
set +a
for v in BIU_PUBLIC_ORIGIN BIU_CLOUD_SSH_ALIAS BIU_CLOUD_ARTIFACT_DIR BIU_WEB_SSH_ALIAS \
  BIU_WEB_RELEASE_ROOT BIU_WEB_AGENT_FILE BIU_WEB_SERVICE_LABEL BIU_WEB_NODE \
  BIU_WEB_PORT BIU_WEB_TEST_PORT BIU_HEALTH_PATH BIU_SYNC_INTERNAL_ORIGIN; do
  : "${!v:?缺少 $v}"
done

SSH="ssh -o BatchMode=yes -o ConnectTimeout=10"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
pkg="/tmp/biu-web-$stamp.tar.gz"

cd "$(git rev-parse --show-toplevel)"

echo "== 0. 连通性"
$SSH "$BIU_CLOUD_SSH_ALIAS" 'echo cloud-ok'
$SSH "$BIU_WEB_SSH_ALIAS" 'echo web-host-ok'

echo "== 1. 构建并打包 ($stamp)"
pnpm build:web >/dev/null
tar -C "$PWD" -czf "$pkg" dist/web dist/server
[ "$(tar -tzf "$pkg" | grep -Ec '\.env$|node_modules|\.pem$|\.key$')" = 0 ] || { echo "发布包含敏感文件，中止"; exit 1; }
local_sha=$(shasum -a 256 "$pkg" | cut -d' ' -f1)

echo "== 2. 上传云主机并校验"
$SSH "$BIU_CLOUD_SSH_ALIAS" "mkdir -p '$BIU_CLOUD_ARTIFACT_DIR'"
scp -q -o BatchMode=yes "$pkg" "$BIU_CLOUD_SSH_ALIAS:$BIU_CLOUD_ARTIFACT_DIR/"
cloud_sha=$($SSH "$BIU_CLOUD_SSH_ALIAS" "shasum -a 256 '$BIU_CLOUD_ARTIFACT_DIR/$(basename "$pkg")'" | cut -d' ' -f1)
[ "$local_sha" = "$cloud_sha" ] || { echo "SHA 不一致，中止"; exit 1; }

echo "== 3. Web 主机：解包、试运行、切换"
$SSH "$BIU_WEB_SSH_ALIAS" \
  "release_stamp='$stamp' cloud='$BIU_CLOUD_SSH_ALIAS' artifact_dir='$BIU_CLOUD_ARTIFACT_DIR' \
   release_base='$BIU_WEB_RELEASE_ROOT' agent_file='$BIU_WEB_AGENT_FILE' label='$BIU_WEB_SERVICE_LABEL' \
   web_node='$BIU_WEB_NODE' port='$BIU_WEB_PORT' test_port='$BIU_WEB_TEST_PORT' health='$BIU_HEALTH_PATH' \
   public_origin='$BIU_PUBLIC_ORIGIN' sync_origin='$BIU_SYNC_INTERNAL_ORIGIN' bash -s" <<'REMOTE'
set -euo pipefail
release_root="$release_base/$release_stamp"
package_file="/tmp/biu-web-$release_stamp.tar.gz"

mkdir -p "$release_root/logs"
scp -o BatchMode=yes "$cloud:$artifact_dir/biu-web-$release_stamp.tar.gz" "$package_file"
tar -xzf "$package_file" -C "$release_root"
test -f "$release_root/dist/web/index.html"
test -f "$release_root/dist/server/web-server/index.js"

# 试运行端口若被占用，健康检查会命中旧进程而假通过；只在确认是上次试运行残留时才清理
if lsof -nP -iTCP:"$test_port" -sTCP:LISTEN; then
  echo "试运行端口 $test_port 已被占用：核实归属后手动处理" >&2
  exit 1
fi
(
  cd "$release_root"
  NODE_ENV=production BIU_WEB_HOST=127.0.0.1 BIU_WEB_PORT="$test_port" \
  BIU_WEB_PUBLIC_ORIGIN="$public_origin" BIU_SYNC_INTERNAL_ORIGIN="$sync_origin" \
  "$web_node" dist/server/web-server/index.js
) >"$release_root/logs/web-test.log" 2>&1 &
tp=$!
sleep 3
kill -0 "$tp" || { echo "试运行进程已退出："; tail -n 30 "$release_root/logs/web-test.log"; exit 1; }
curl -fsS "http://127.0.0.1:$test_port$health" | grep -q '"status":"ok"'
curl -fsS -G "http://127.0.0.1:$test_port/__biu_lyrics/lrclib/search" --data-urlencode q=spiral | grep -q '"syncedLyrics"'
kill "$tp"; wait "$tp" 2>/dev/null || true
echo "试运行通过"

cp "$agent_file" "$agent_file.bak-$release_stamp"
for i in $(seq 64 -1 2); do plutil -remove "ProgramArguments.$i" "$agent_file" >/dev/null 2>&1 || true; done
plutil -replace ProgramArguments.1 -string "$release_root/dist/server/web-server/index.js" "$agent_file"
plutil -replace WorkingDirectory -string "$release_root" "$agent_file"
plutil -replace StandardOutPath -string "$release_root/logs/web.out.log" "$agent_file"
plutil -replace StandardErrorPath -string "$release_root/logs/web.err.log" "$agent_file"
plutil -lint "$agent_file"

# bootout 异步：必须等 job 消失再 bootstrap，否则 I/O error 且服务停在空窗里
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
for i in $(seq 1 30); do launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1 && sleep 0.2 || break; done
sleep 1
launchctl bootstrap "gui/$(id -u)" "$agent_file"
launchctl kickstart -k "gui/$(id -u)/$label"
sleep 3
curl -fsS "http://127.0.0.1:$port$health"; echo
launchctl print "gui/$(id -u)/$label" | grep -E 'state ='
REMOTE

echo "== 4. 公网验收"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BIU_PUBLIC_ORIGIN$BIU_HEALTH_PATH" || true)
[ "$code" = 200 ] || { echo "公网健康检查 $code，按指南 §7 用 plist.bak-$stamp 回滚"; exit 1; }
echo "完成：release $stamp 已上线；回滚备份 $(basename "$BIU_WEB_AGENT_FILE").bak-$stamp"
