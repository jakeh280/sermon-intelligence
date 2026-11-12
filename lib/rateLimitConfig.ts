export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
// Per address, persistent hourly analysis allowance. Raised from 5 on
// 2026-07-19: Gemini spend was $0.13 across 90 days against a $5 monthly cap,
// so the old limit was throttling real users to protect against a cost that
// never materialized.
export const RATE_LIMIT_MAX_REQUESTS = 20;

// The persistent limiter enforces the hourly analysis allowance. This cheap
// filter only stops rapid bursts, so service failures cannot exhaust an hour.
export const BURST_WINDOW_MS = 60 * 1000;
export const BURST_MAX_REQUESTS = 60;
