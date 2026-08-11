export type HistoryItem = {
  id: string;
  timestamp: number;
  label: string;
  output: string;
  clipMinSec: number;
  clipMaxSec: number;
};

function isHistoryItem(value: unknown): value is HistoryItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.timestamp === "number" &&
    Number.isFinite(item.timestamp) &&
    typeof item.label === "string" &&
    typeof item.output === "string" &&
    typeof item.clipMinSec === "number" &&
    Number.isFinite(item.clipMinSec) &&
    typeof item.clipMaxSec === "number" &&
    Number.isFinite(item.clipMaxSec)
  );
}

export function parseHistory(raw: string | null): HistoryItem[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(isHistoryItem).slice(0, 10);
  } catch {
    return [];
  }
}
