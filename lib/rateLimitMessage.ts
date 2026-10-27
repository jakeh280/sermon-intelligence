/**
 * Turns a Retry-After in seconds into words. The per-address limit clears
 * within the hour, but the Worker's sitewide daily and monthly budgets answer
 * with a Retry-After of up to a day or a month, which read as "Try again in
 * 1440 minutes" when everything was said in minutes.
 */
export function formatRetryAfter(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 120) return plural(minutes, "minute");
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.ceil(hours / 24), "day");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

export function rateLimitMessage(retryAfterSeconds: number): string {
  return `Analysis limit reached. Try again in ${formatRetryAfter(retryAfterSeconds)}.`;
}
