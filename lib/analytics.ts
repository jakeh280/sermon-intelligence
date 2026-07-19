/**
 * GA4 event helper.
 *
 * Pageviews cannot tell whether anyone actually used the tool. These events
 * measure the thing that matters: did a sermon get processed, and if not, why.
 * `sermon_rate_limited` is deliberately tracked because the free tier limit
 * turning users away is invisible in every other metric.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function track(event: string, params: Record<string, string | number> = {}) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", event, params);
}
