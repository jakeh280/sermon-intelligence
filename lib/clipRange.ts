export const CLIP_FLOOR_SEC = 15;
export const CLIP_CEIL_SEC = 600;
export const CLIP_STEP = 5;

export function snapClipSec(value: number): number {
  const rounded = Math.round(value / CLIP_STEP) * CLIP_STEP;
  return Math.min(CLIP_CEIL_SEC, Math.max(CLIP_FLOOR_SEC, rounded));
}

export function formatDurationSec(totalSec: number): string {
  const seconds = Math.max(0, Math.round(totalSec));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}
