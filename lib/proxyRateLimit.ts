/**
 * Pure rate-limit decision logic for `proxy.ts`. Kept separate from the
 * NextRequest/NextResponse glue so it can be unit tested with plain objects -
 * `next/server`'s classes aren't resolvable outside Next's own build, which
 * is why this used to live untested inside proxy.ts itself.
 *
 * Sliding window (a per-IP list of request timestamps, pruned to the
 * trailing `windowMs`), not a fixed window that resets on the hour: a fixed
 * window lets a burst of `maxRequests` land right before the reset and
 * another full `maxRequests` land right after, admitting up to ~2x the
 * limit within a short span straddling the boundary. This module used to be
 * a fixed window backing proxy.ts, with a *separate* sliding-window check
 * duplicated in the API route as a second layer specifically to close that
 * gap. Consolidating to one limiter (2026-09-08) meant this one had to be
 * the stricter of the two, not the looser one, or removing the duplicate
 * would have quietly loosened the real guarantee.
 */

import { isCloudflareIp } from "./cloudflareIps.ts";

/** The slice of `Headers` this module needs, so tests can supply a plain object. */
export type HeaderReader = { get(name: string): string | null };

/**
 * The address to rate-limit on. Vercel overwrites `x-forwarded-for` with the
 * address that connected to it, which for the Cloudflare-proxied domain is a
 * Cloudflare edge shared by every visitor routed through that location, so on
 * its own it most likely put a whole region in one 20-per-hour bucket (Vercel's
 * documented behavior; not probed live). When the connecting
 * address is a real Cloudflare edge, `cf-connecting-ip` carries the visitor's
 * own address; otherwise (direct hits on the Vercel origin, local dev) that
 * header could be forged, so the connecting address is used as before.
 */
export function getClientIp(headers: HeaderReader): string {
  const connecting =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    null;
  const visitor = headers.get("cf-connecting-ip")?.trim();
  if (visitor && connecting && isCloudflareIp(connecting)) return visitor;
  return connecting ?? "unknown";
}

function prune(timestamps: number[], now: number, windowMs: number): number[] {
  return timestamps.filter((t) => now - t < windowMs);
}

/** Drops IPs with nothing left in the window, so the map doesn't grow forever. */
function evictEmpty(
  store: Map<string, number[]>,
  now: number,
  windowMs: number,
): void {
  for (const [ip, timestamps] of store) {
    if (prune(timestamps, now, windowMs).length === 0) store.delete(ip);
  }
}

export type RateLimitResult =
  | { limited: false }
  | { limited: true; resetInMinutes: number };

/**
 * Checks `ip` against `store` for the trailing `windowMs` and, if it isn't
 * already at `maxRequests`, records this request against it. `store` is
 * mutated in place so a real caller's map doesn't grow without bound.
 */
export function checkAndRecord(
  store: Map<string, number[]>,
  ip: string,
  now: number,
  windowMs: number,
  maxRequests: number,
): RateLimitResult {
  evictEmpty(store, now, windowMs);

  const existing = prune(store.get(ip) ?? [], now, windowMs);

  if (existing.length >= maxRequests) {
    store.set(ip, existing);
    // The window clears one request at a time as the oldest timestamps age
    // out, not all at once, so "reset" here means "the oldest hit in the
    // current window falls out of it" - not a fixed clock boundary.
    const resetInMs = windowMs - (now - existing[0]);
    return { limited: true, resetInMinutes: Math.ceil(resetInMs / 60000) };
  }

  existing.push(now);
  store.set(ip, existing);
  return { limited: false };
}
