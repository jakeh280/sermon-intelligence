import { createHmac } from "node:crypto";

type Result = { allowed: true } | { allowed: false; status: 429 | 503; retryAfter: number };

export async function sharedRateLimit(
  ip: string,
  settings = {
    url: process.env.ABUSE_LIMITER_URL,
    secret: process.env.ABUSE_LIMITER_SECRET,
    required: process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview",
  },
  send: typeof fetch = fetch,
): Promise<Result> {
  if (!settings.url || !settings.secret) {
    return settings.required ? { allowed: false, status: 503, retryAfter: 60 } : { allowed: true };
  }
  try {
    const url = new URL(settings.url);
    if (url.protocol !== "https:" || url.username || url.password) throw Error("Invalid limiter URL");
    const response = await send(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.secret}`, "Content-Type": "application/json" },
      // Cloudflare receives a keyed digest, never the visitor's raw IP or transcript.
      body: JSON.stringify({ ip: createHmac("sha256", settings.secret).update(ip).digest("hex") }),
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) throw Error("Limiter unavailable");
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null || !("allowed" in result)) throw Error("Invalid limiter response");
    if (result.allowed === true) return { allowed: true };
    if (result.allowed === false && "retryAfter" in result && typeof result.retryAfter === "number" &&
        Number.isFinite(result.retryAfter) && result.retryAfter > 0) {
      return { allowed: false, status: 429, retryAfter: Math.ceil(result.retryAfter) };
    }
    throw Error("Invalid limiter response");
  } catch {
    console.error("ABUSE_LIMITER_UNAVAILABLE");
    return { allowed: false, status: 503, retryAfter: 60 };
  }
}
