import { createHmac } from "node:crypto";

export type LimitScope = "address" | "site";
type Result =
  | { allowed: true }
  | { allowed: false; status: 429; retryAfter: number; scope: LimitScope }
  | { allowed: false; status: 503; retryAfter: number };

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
    if (settings.required) console.error("ABUSE_LIMITER_UNAVAILABLE", { reason: "missing_config" });
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
    if (!response.ok) {
      // Status is safe to log. Bodies, headers and URLs can contain secrets.
      console.error("ABUSE_LIMITER_UNAVAILABLE", { reason: "http_error", status: response.status });
      return { allowed: false, status: 503, retryAfter: 60 };
    }
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null || !("allowed" in result)) throw Error("Invalid limiter response");
    if (result.allowed === true) return { allowed: true };
    if (result.allowed === false && "retryAfter" in result && typeof result.retryAfter === "number" &&
        Number.isFinite(result.retryAfter) && result.retryAfter > 0) {
      // A Worker deployed before the scope field existed only ever meant this address.
      const scope: LimitScope = "scope" in result && result.scope === "site" ? "site" : "address";
      return { allowed: false, status: 429, retryAfter: Math.ceil(result.retryAfter), scope };
    }
    throw Error("Invalid limiter response");
  } catch (error) {
    console.error("ABUSE_LIMITER_UNAVAILABLE", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return { allowed: false, status: 503, retryAfter: 60 };
  }
}
