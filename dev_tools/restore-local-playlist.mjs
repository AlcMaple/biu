#!/usr/bin/env node
/**
 * 从同步备份还原本地歌单数据。
 *
 * 数据源有两处，都在应用数据目录下：
 *   - playlist-sync-backups.json —— 每次同步推送前的滚动备份（保留最近 10 份，2.5.1+ 才有）
 *   - playlist-sync-meta.json    —— preMigrationBackups，首次迁移那天写一次，之后永不更新
 *
 * 用法：
 *   node dev_tools/restore-local-playlist.mjs            # 只列出可用备份，不动任何文件
 *   node dev_tools/restore-local-playlist.mjs --apply    # 用最新一份备份还原（自动先备份现状）
 *   node dev_tools/restore-local-playlist.mjs --apply --pick favorites=2,fav-items=0
 *
 * `--pick` 里的数字是列表中的序号（0 = 最新）；`pre` 表示用 preMigrationBackups。
 * 还原前会把现有的三个 json 复制成 *.before-restore-<时间戳>.json，不会不可逆。
 *
 * ⚠️ 跑之前请先完全退出 Biu，否则应用退出时会用内存里的状态把文件盖回去。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const STORES = ["favorites", "fav-items", "tags"];

/** 每个同步 store 对应落盘的文件名和反解方式（与 src/service/sync/codec.ts 保持一致） */
const TARGETS = {
  favorites: { file: "local-favorites.json", decode: decodeFavorites },
  "fav-items": { file: "local-fav-items.json", decode: decodeFavItems },
  tags: { file: "tags.json", decode: decodeTags },
};

/**
 * userData 目录名各平台/各构建不一致：macOS 生产是 `Biu`（productName），dev 是 `biu-dev`，
 * Windows 上实测是 `biu`。挨个探测哪个真的存在，别写死——写死会让工具"找不到备份"，
 * 而这工具恰恰是数据出事时才会用到的。
 */
function userDataDir() {
  if (process.env.BIU_DATA_DIR) return process.env.BIU_DATA_DIR;

  const roots =
    process.platform === "win32"
      ? [process.env.APPDATA ?? ""]
      : process.platform === "darwin"
        ? [path.join(os.homedir(), "Library", "Application Support")]
        : [path.join(os.homedir(), ".config")];

  const candidates = roots.flatMap(root => ["Biu", "biu", "biu-dev"].map(name => path.join(root, name)));
  // 优先选真的有同步记账文件的那个（可能同时存在生产和 dev 两份目录）
  const withMeta = candidates.find(dir => fs.existsSync(path.join(dir, "playlist-sync-meta.json")));
  return withMeta ?? candidates.find(dir => fs.existsSync(dir)) ?? candidates[0];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

/** 快照是 { id: { updatedAt, payload } | { __deleted: true } }，只取活条目的 payload */
function livePayloads(snapshot) {
  return Object.entries(snapshot ?? {})
    .filter(([, entry]) => entry && !entry.__deleted)
    .map(([id, entry]) => [id, entry.payload]);
}

function decodeFavorites(snapshot) {
  const createdFavorites = livePayloads(snapshot).map(([, payload]) => payload);
  return { createdFavorites, createdOrder: createdFavorites.map(item => item.id) };
}

function decodeFavItems(snapshot) {
  const folderItems = {};
  for (const [, payload] of livePayloads(snapshot)) {
    (folderItems[payload.folderId] ??= []).push(payload.item);
  }
  return { folderItems };
}

function decodeTags(snapshot) {
  const tags = [];
  const itemTags = {};
  for (const [id, payload] of livePayloads(snapshot)) {
    if (id.startsWith("tag:")) tags.push(payload);
    else if (id.startsWith("item:")) itemTags[id.slice("item:".length)] = payload;
  }
  return { tags, itemTags };
}

/** 汇总某个 store 所有可用的备份候选，最新在前，preMigration 垫底 */
function candidatesFor(store, backupsData, metaData, mid) {
  const rolling = (backupsData?.[mid]?.[store] ?? []).map((entry, index) => ({
    key: String(index),
    label: `滚动备份 #${index}（${new Date(entry.at).toLocaleString()}）`,
    snapshot: entry.snapshot,
  }));
  const pre = metaData?.[mid]?.preMigrationBackups?.[store];
  if (pre) {
    rolling.push({ key: "pre", label: "首次迁移前快照（preMigrationBackups，只写过一次）", snapshot: pre });
  }
  return rolling;
}

function countEntries(snapshot, store) {
  const decoded = TARGETS[store].decode(snapshot);
  if (store === "favorites") return `${decoded.createdFavorites.length} 个歌单夹`;
  if (store === "fav-items") {
    const total = Object.values(decoded.folderItems).reduce((sum, list) => sum + list.length, 0);
    return `${total} 首歌 / ${Object.keys(decoded.folderItems).length} 个夹`;
  }
  return `${decoded.tags.length} 个标签 / ${Object.keys(decoded.itemTags).length} 条打标`;
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const pickArg = args.find(a => a.startsWith("--pick="))?.slice("--pick=".length);
  const picks = Object.fromEntries(
    (pickArg ?? "")
      .split(",")
      .filter(Boolean)
      .map(p => p.split("=")),
  );

  const dir = userDataDir();
  console.log(`数据目录：${dir}\n`);

  const meta = readJson(path.join(dir, "playlist-sync-meta.json"));
  const backups = readJson(path.join(dir, "playlist-sync-backups.json"));
  if (!meta && !backups) {
    console.error("没找到 playlist-sync-meta.json / playlist-sync-backups.json，无法还原。");
    process.exit(1);
  }

  const mids = [...new Set([...Object.keys(meta ?? {}), ...Object.keys(backups ?? {})])];
  if (mids.length === 0) {
    console.error("备份文件里没有任何用户数据。");
    process.exit(1);
  }
  const mid = mids[0];
  if (mids.length > 1) console.log(`⚠️ 发现多个 mid（${mids.join(", ")}），使用第一个：${mid}\n`);

  const chosen = {};
  for (const store of STORES) {
    const list = candidatesFor(store, backups, meta, mid);
    console.log(`【${store}】`);
    if (list.length === 0) {
      console.log("  （无可用备份）\n");
      continue;
    }
    list.forEach(c => console.log(`  [${c.key}] ${c.label} —— ${countEntries(c.snapshot, store)}`));
    const wantKey = picks[store] ?? list[0].key;
    const picked = list.find(c => c.key === wantKey);
    if (!picked) {
      console.error(`  ✗ --pick 指定的 ${store}=${wantKey} 不存在`);
      process.exit(1);
    }
    chosen[store] = picked;
    console.log(`  → 将使用 [${picked.key}] ${picked.label}\n`);
  }

  if (!apply) {
    console.log("以上仅为预览，未修改任何文件。确认无误后加 --apply 执行（务必先完全退出 Biu）。");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const [store, picked] of Object.entries(chosen)) {
    const target = path.join(dir, TARGETS[store].file);
    if (fs.existsSync(target)) {
      const backupPath = target.replace(/\.json$/, `.before-restore-${stamp}.json`);
      fs.copyFileSync(target, backupPath);
      console.log(`已备份现状：${path.basename(backupPath)}`);
    }
    // 合并写入：只覆盖这次还原涉及的字段，保留文件里其他字段（如 collectedOrder）
    const existing = readJson(target) ?? {};
    fs.writeFileSync(target, JSON.stringify({ ...existing, ...TARGETS[store].decode(picked.snapshot) }, null, 2));
    console.log(`✓ 已还原 ${TARGETS[store].file}`);
  }

  console.log(
    "\n完成。另外请把 playlist-sync-meta.json 里该 mid 的 versions / snapshots 删掉（或整个文件删掉），" +
      "让下次启动走「首次迁移」的只增不删路径，避免还原后的数据被云端墓碑再删一遍。",
  );
}

main();
