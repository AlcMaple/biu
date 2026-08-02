export const STORE_NAMES = ["favorites", "fav-items", "tags"] as const;

export type StoreName = (typeof STORE_NAMES)[number];

export function isStoreName(value: string): value is StoreName {
  return (STORE_NAMES as readonly string[]).includes(value);
}
