import { HISTORY_LIMIT, parseHistory, type HistoryItem } from "./history.ts";

export const HISTORY_KEY = "sermon_history";
export { HISTORY_LIMIT };

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

/**
 * `crypto.randomUUID` is missing on older Safari and absent outside secure
 * contexts, where it would throw while saving a result the user just waited for.
 * The id only has to be unique within one browser's history list.
 */
export function createHistoryId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
 * which case the oldest entries are dropped until the write succeeds. If
 * nothing fits, even a single item, whatever was already persisted is left
 * alone rather than cleared: a write that doesn't fit says nothing about
 * whether the existing, already-written list is still good.
 */
export function writeHistory(
  storage: HistoryStorage | null,
  items: HistoryItem[],
): HistoryItem[] {
  const capped = items.slice(0, HISTORY_LIMIT);
  if (!storage) return capped;

  if (capped.length === 0) {
    // An empty target list is a real, deliberate state (the last item was
    // just deleted), not a write that failed to fit - the loop below never
    // runs for a zero-length list, which would otherwise fall through to
    // the "every attempt failed" fallback and read back whatever was on
    // disk *before* this call, undoing the deletion it was asked to make.
    clearStoredHistory(storage);
    return [];
  }

  for (let size = capped.length; size > 0; size -= 1) {
    const attempt = capped.slice(0, size);
    try {
      storage.setItem(HISTORY_KEY, JSON.stringify(attempt));
      return attempt;
    } catch {
      continue;
    }
  }

  // Every attempt failed, down to a single item. That isn't evidence the
  // list already on disk is bad - it's evidence *this* write doesn't fit
  // (a quota already near full, or one huge new result on its own) - so
  // leave storage untouched rather than clearing it. Read back what's still
  // there instead of assuming it's still `items`: another tab, or a
  // previous successful call, may have left something different.
  return readHistory(storage);
}

export function clearStoredHistory(storage: HistoryStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(HISTORY_KEY);
  } catch {
    // Nothing left to do: the entry is unreachable either way.
  }
}
