export const CLIP_FLOOR_SEC = 15;
export const CLIP_CEIL_SEC = 600;
export const CLIP_STEP = 5;

export function snapClipSec(value: number): number {
  const rounded = Math.round(value / CLIP_STEP) * CLIP_STEP;
  return Math.min(CLIP_CEIL_SEC, Math.max(CLIP_FLOOR_SEC, rounded));
}

export function parseClipBounds(
  body: unknown,
): { min: number; max: number } | null {
  if (typeof body !== "object" || body === null) return null;

  const values = body as Record<string, unknown>;
  const minRaw = values.clipMinSec;
  const maxRaw = values.clipMaxSec;

  if (typeof minRaw !== "number" || typeof maxRaw !== "number") return null;
  if (!Number.isFinite(minRaw) || !Number.isFinite(maxRaw)) return null;

  const min = snapClipSec(minRaw);
  const max = snapClipSec(maxRaw);
  return min <= max ? { min, max } : null;
}

export function formatDurationSec(totalSec: number): string {
  const seconds = Math.max(0, Math.round(totalSec));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}
