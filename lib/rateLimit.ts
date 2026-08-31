import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/rateLimitConfig";

// In-memory per-instance rate limit. Vercel keeps serverless functions warm
// across nearby requests, so this catches scripted bursts against a single
// instance even though it doesn't share state across instances/regions.
// If abuse shows up in the Gemini usage dashboard despite this, the next
// step is a shared store (Upstash Redis / Vercel KV) keyed the same way.

const hits = new Map<string, number[]>();

function prune(timestamps: number[], now: number): number[] {
  return timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
}

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const existing = prune(hits.get(key) || [], now);

  if (existing.length >= RATE_LIMIT_MAX_REQUESTS) {
    hits.set(key, existing);
    return true;
  }

  existing.push(now);
  hits.set(key, existing);

  // Bound memory: drop stale keys once the map gets large.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (prune(v, now).length === 0) hits.delete(k);
    }
  }

  return false;
}

export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "unknown";
}
