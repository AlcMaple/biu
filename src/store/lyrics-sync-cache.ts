/**
 * Module-level cache for background lyrics sync results.
 * Keyed by the original LRC string so the preview modal can retrieve a result
 * even after being closed and re-opened.
 */
export const lyricsSyncCache = new Map<string, string>();
