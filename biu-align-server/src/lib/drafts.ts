import { rm } from "node:fs/promises";
import path from "node:path";

import type { LyricLine } from "./lyrics.js";
import type { Alignment } from "./result.js";

import { listJson, readJson, writeJsonAtomic } from "./json-file.js";
import { ALIGNER_VERSION } from "./result.js";

export interface Draft {
  bvid: string;
  cid: string;
  lyricsHash: string;
  alignment: Alignment;
  by: string;
  createdAt: number;
}

// 管理员手动重跑的结果先放这里，发布时才进对齐缓存。不能直接写缓存：同一份歌词的键和生效版本相同，
// 一写就等于没试听就替换了所有人在用的版本，放弃也撤不回，报错里「被报的那份」也跟着没了。
// 键与对齐缓存相同（投稿/分P/歌词哈希），按投稿 + 分 P 分目录，方便查「这首歌有没有没发布的草稿」
export class DraftStore {
  constructor(
    private readonly dataDir: string,
    private readonly namespace = `v${ALIGNER_VERSION}`,
  ) {}

  private dir(bvid: string, cid: string) {
    return path.join(this.dataDir, "drafts", this.namespace, bvid, cid);
  }

  private file(t: { bvid: string; cid: string; lyricsHash: string }) {
    return path.join(this.dir(t.bvid, t.cid), `${t.lyricsHash}.json`);
  }

  get(t: { bvid: string; cid: string; lyricsHash: string }) {
    return readJson<Draft>(this.file(t));
  }

  put(draft: Draft) {
    return writeJsonAtomic(this.file(draft), draft);
  }

  delete(t: { bvid: string; cid: string; lyricsHash: string }) {
    return rm(this.file(t), { force: true });
  }

  async latest(bvid: string, cid: string): Promise<Draft | undefined> {
    const all = await listJson<Draft>(this.dir(bvid, cid));
    return all.sort((a, b) => b.createdAt - a.createdAt)[0];
  }
}

// 每次对齐成功都留下送去对齐的原歌词：报错只记了歌词哈希，审核页要在不播放这首的情况下重跑，得有原文。
// 和算法版本无关，不分命名空间
export class InputStore {
  constructor(
    private readonly dataDir: string,
    private readonly namespace = "default",
  ) {}

  private file(key: string) {
    return path.join(this.dataDir, "inputs", this.namespace, `${key}.json`);
  }

  get(key: string) {
    return readJson<LyricLine[]>(this.file(key));
  }

  put(key: string, lines: LyricLine[]) {
    return writeJsonAtomic(this.file(key), lines);
  }
}
