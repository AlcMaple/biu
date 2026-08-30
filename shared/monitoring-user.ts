export interface BiuMonitoringUser {
  id: string;
  username?: string;
}

const USER_ID_PATTERN = /^[1-9]\d{0,19}$/;
const MAX_USERNAME_LENGTH = 128;

function normalizeUserId(value: unknown): string | undefined {
  const id =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : undefined;
  return id && USER_ID_PATTERN.test(id) ? id : undefined;
}

function normalizeUsername(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const username = value.trim().slice(0, MAX_USERNAME_LENGTH);
  return username || undefined;
}

export function toBiuMonitoringUser(user: { mid?: unknown; uname?: unknown } | null | undefined) {
  if (!user || typeof user !== "object") return null;

  const id = normalizeUserId(user.mid);
  if (!id) return null;

  const username = normalizeUsername(user.uname);
  return username ? { id, username } : { id };
}

export function sanitizeBiuMonitoringUser(user: unknown): BiuMonitoringUser | undefined {
  if (!user || typeof user !== "object") return undefined;

  const record = user as Record<string, unknown>;
  const id = normalizeUserId(record.id);
  if (!id) return undefined;

  const username = normalizeUsername(record.username);
  return username ? { id, username } : { id };
}
