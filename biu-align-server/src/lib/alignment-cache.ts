import path from "node:path";

import type { Alignment } from "./result.js";

import { readJson, writeJsonAtomic } from "./json-file.js";
import { ALIGNER_VERSION } from "./result.js";

const MEMORY_ENTRIES = 200;

// 两级缓存：内存 LRU 挡住同一首歌被很多人同时打开，磁盘保证重启后不必重新花 2 min CPU。
// 键 = 投稿 + 分 P + 歌词哈希 + 算法版本；同一投稿换一份歌词就是另一条缓存
export class AlignmentCache {
  private memory = new Map<string, Alignment>();

  constructor(private readonly dataDir: string) {}

  private file(key: string) {
    return path.join(this.dataDir, "alignments", `v${ALIGNER_VERSION}`, `${key}.json`);
  }

  async get(key: string): Promise<Alignment | undefined> {
    const hit = this.memory.get(key);
    if (hit) {
      this.memory.delete(key);
      this.memory.set(key, hit);
      return hit;
    }
    const disk = await readJson<Alignment>(this.file(key));
    if (disk) this.remember(key, disk);
    return disk;
  }

  async put(key: string, value: Alignment): Promise<void> {
    await writeJsonAtomic(this.file(key), value);
    this.remember(key, value);
  }

  private remember(key: string, value: Alignment) {
    this.memory.delete(key);
    this.memory.set(key, value);
    while (this.memory.size > MEMORY_ENTRIES) this.memory.delete(this.memory.keys().next().value!);
  }
}
