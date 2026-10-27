import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from "../lib/rateLimitConfig.ts";
import { formatRetryAfter, rateLimitMessage } from "../lib/rateLimitMessage.ts";

test("short waits are said in minutes, rounded up", () => {
  assert.equal(formatRetryAfter(1), "1 minute");
  assert.equal(formatRetryAfter(59), "1 minute");
  assert.equal(formatRetryAfter(61), "2 minutes");
  assert.equal(formatRetryAfter(3600), "60 minutes");
  assert.equal(formatRetryAfter(119 * 60), "119 minutes");
});

test("a sitewide daily or monthly wait is said in hours or days", () => {
  assert.equal(formatRetryAfter(2 * 3600), "2 hours");
  assert.equal(formatRetryAfter(86_400), "24 hours");
  assert.equal(formatRetryAfter(47 * 3600 + 1), "2 days");
  assert.equal(formatRetryAfter(30 * 86_400), "30 days");
});

test("the message reads as a sentence", () => {
  assert.equal(rateLimitMessage(60), "Analysis limit reached. Try again in 1 minute.");
  assert.equal(rateLimitMessage(86_400), "Analysis limit reached. Try again in 24 hours.");
});

test("the Worker's per-address limit matches lib/rateLimitConfig.ts", () => {
  // The Worker can't import the TypeScript config, so this keeps the two copies
  // from drifting apart.
  const source = readFileSync(
    new URL("../workers/abuse-limiter/worker.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, new RegExp(`hits\\.length >= ${RATE_LIMIT_MAX_REQUESTS}\\)`));
  const windows = source.match(/\b\d{7,}\b/g) ?? [];
  assert.ok(windows.length > 0);
  for (const value of windows) assert.equal(Number(value), RATE_LIMIT_WINDOW_MS);
});
