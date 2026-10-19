import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// 先写临时文件再 rename：进程中途被杀时，磁盘上只会是旧文件或新文件，不会是写了一半的 JSON
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function listJson<T>(dir: string): Promise<T[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: T[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const value = await readJson<T>(path.join(dir, name));
    if (value) out.push(value);
  }
  return out;
}
