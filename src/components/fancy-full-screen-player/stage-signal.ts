export const getStageProgress = (time: number, duration: number) =>
  Number.isFinite(time) && Number.isFinite(duration) && duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;

/** Low-frequency energy, not a BPM/chorus detector. Silence must remain silent. */
export const getBassEnergy = (bins: Uint8Array) => {
  const end = Math.min(18, bins.length);
  if (end <= 1) return 0;
  let sum = 0;
  for (let i = 1; i < end; i++) sum += bins[i] / 255;
  return sum / (end - 1);
};
