import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const SESSION_FILE = "sessions.enc";
const KEY_FILE = "session.key";
const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SessionPersistenceOptions {
  /** 保存会话的目录；与代码 release 分离，切换发布版本时登录态不丢 */
  dir: string;
  /** 显式密钥（BIU_WEB_SESSION_KEY）；缺省时在 dir 下生成并复用 0600 的 session.key */
  key?: string;
  logger?: Pick<Console, "warn">;
}

export interface SessionPersistence {
  load: () => Promise<unknown[] | undefined>;
  save: (entries: unknown[]) => Promise<void>;
}

async function resolveKey(dir: string, explicit?: string): Promise<Buffer> {
  if (explicit) return createHash("sha256").update(explicit).digest();

  const keyPath = path.join(dir, KEY_FILE);
  try {
    const existing = Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64");
    if (existing.length === 32) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const key = randomBytes(32);
  await writeFile(keyPath, key.toString("base64"), { mode: 0o600 });
  await chmod(keyPath, 0o600);
  return key;
}

/**
 * 会话落盘：AES-256-GCM 加密，临时文件 + rename 原子替换，权限 0600。
 * B 站 Cookie / refresh_token 只以密文形式出现在磁盘上。
 */
export function createSessionPersistence(options: SessionPersistenceOptions): SessionPersistence {
  const logger = options.logger ?? console;
  const file = path.join(options.dir, SESSION_FILE);
  let keyPromise: Promise<Buffer> | undefined;

  const getKey = async () => {
    keyPromise ??= mkdir(options.dir, { mode: 0o700, recursive: true }).then(() =>
      resolveKey(options.dir, options.key),
    );
    return keyPromise;
  };

  return {
    async load() {
      let raw: Buffer;
      try {
        raw = await readFile(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }

      try {
        const key = await getKey();
        const iv = raw.subarray(0, IV_BYTES);
        const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
        const parsed = JSON.parse(plain.toString("utf8")) as { sessions?: unknown[]; version?: number };
        if (parsed.version !== FORMAT_VERSION || !Array.isArray(parsed.sessions)) throw new Error("unknown format");
        return parsed.sessions;
      } catch (error) {
        // 密钥变更或文件损坏：留一份备份供排查，本次从空会话开始（用户重新扫码）
        const backup = `${file}.corrupt-${Date.now()}`;
        await rename(file, backup).catch(() => undefined);
        logger.warn(`[web-auth] cannot read persisted sessions, moved to ${backup}`, error);
        return undefined;
      }
    },

    async save(entries) {
      const key = await getKey();
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([
        cipher.update(JSON.stringify({ sessions: entries, version: FORMAT_VERSION }), "utf8"),
        cipher.final(),
      ]);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, Buffer.concat([iv, cipher.getAuthTag(), body]), { mode: 0o600 });
      await rename(tmp, file);
    },
  };
}
