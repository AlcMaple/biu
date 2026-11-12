export function isMediaSafetyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== "object") return false;
  const { status, data } = response as { status?: unknown; data?: unknown };
  return (
    status === 423 &&
    Boolean(data && typeof data === "object" && (data as { code?: unknown }).code === "BIU_MEDIA_PAUSED")
  );
}
