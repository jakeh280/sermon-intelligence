import { parseHistory, type HistoryItem } from "./history.ts";

export const HISTORY_KEY = "sermon_history";
export const HISTORY_LIMIT = 10;

/** The slice of `Storage` this module needs, so tests can supply a fake. */
export type HistoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * Browsers can refuse storage entirely: Safari in private mode throws on write,
 * and a blocked cookie policy can throw on the `localStorage` property itself.
 * History is a convenience, so every path here degrades to "no history" rather
 * than taking the page down with it.
 */
export function historyStorage(): HistoryStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readHistory(storage: HistoryStorage | null): HistoryItem[] {
  if (!storage) return [];
  try {
    return parseHistory(storage.getItem(HISTORY_KEY));
  } catch {
    return [];
  }
}

/**
 * Persists as much history as the browser will accept and returns what actually
 * landed, so React state cannot drift from what a reload would show. A single
 * long sermon output can be large enough to exhaust the quota on its own, in
 * which case the oldest entries are dropped until the write succeeds.
 */
export function writeHistory(
  storage: HistoryStorage | null,
  items: HistoryItem[],
): HistoryItem[] {
  const capped = items.slice(0, HISTORY_LIMIT);
  if (!storage) return capped;

  for (let size = capped.length; size > 0; size -= 1) {
    const attempt = capped.slice(0, size);
    try {
      storage.setItem(HISTORY_KEY, JSON.stringify(attempt));
      return attempt;
    } catch {
      continue;
    }
  }

  clearStoredHistory(storage);
  return [];
}

export function clearStoredHistory(storage: HistoryStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(HISTORY_KEY);
  } catch {
    // Nothing left to do: the entry is unreachable either way.
  }
}
