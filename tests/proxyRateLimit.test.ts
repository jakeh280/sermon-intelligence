import assert from "node:assert/strict";
import test from "node:test";

import { checkAndRecord, getClientIp } from "../lib/proxyRateLimit.ts";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS = 20;

function headers(entries: Record<string, string>) {
  return {
    get(name: string) {
      return entries[name.toLowerCase()] ?? null;
    },
  };
}

test("client ip prefers x-forwarded-for, falls back to x-real-ip, then unknown", () => {
  assert.equal(
    getClientIp(headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })),
    "1.2.3.4",
  );
  assert.equal(getClientIp(headers({ "x-real-ip": "9.9.9.9" })), "9.9.9.9");
  assert.equal(getClientIp(headers({})), "unknown");
});

test("requests under the limit are allowed and counted", () => {
  const store = new Map<string, number[]>();
  const now = Date.now();

  for (let i = 0; i < MAX_REQUESTS; i += 1) {
    const result = checkAndRecord(store, "1.1.1.1", now, WINDOW_MS, MAX_REQUESTS);
    assert.equal(result.limited, false);
  }

  assert.equal(store.get("1.1.1.1")?.length, MAX_REQUESTS);
});

test("the request that crosses the limit is rejected with a reset time", () => {
  const store = new Map<string, number[]>();
  const now = Date.now();

  for (let i = 0; i < MAX_REQUESTS; i += 1) {
    checkAndRecord(store, "1.1.1.1", now, WINDOW_MS, MAX_REQUESTS);
  }

  const result = checkAndRecord(store, "1.1.1.1", now, WINDOW_MS, MAX_REQUESTS);
  assert.equal(result.limited, true);
  assert.equal(result.limited && result.resetInMinutes, 60);
});

test("different IPs are tracked independently", () => {
  const store = new Map<string, number[]>();
  const now = Date.now();

  for (let i = 0; i < MAX_REQUESTS; i += 1) {
    checkAndRecord(store, "1.1.1.1", now, WINDOW_MS, MAX_REQUESTS);
  }

  const blocked = checkAndRecord(store, "1.1.1.1", now, WINDOW_MS, MAX_REQUESTS);
  const otherIp = checkAndRecord(store, "2.2.2.2", now, WINDOW_MS, MAX_REQUESTS);

  assert.equal(blocked.limited, true);
  assert.equal(otherIp.limited, false);
});

test("the window clears once every hit in it has fully elapsed", () => {
  const store = new Map<string, number[]>();
  const start = Date.now();

  for (let i = 0; i < MAX_REQUESTS; i += 1) {
    checkAndRecord(store, "1.1.1.1", start, WINDOW_MS, MAX_REQUESTS);
  }
  assert.equal(
    checkAndRecord(store, "1.1.1.1", start, WINDOW_MS, MAX_REQUESTS).limited,
    true,
  );

  const afterWindow = start + WINDOW_MS + 1;
  const result = checkAndRecord(store, "1.1.1.1", afterWindow, WINDOW_MS, MAX_REQUESTS);
  assert.equal(result.limited, false);
  assert.equal(store.get("1.1.1.1")?.length, 1);
});

// This is the difference a sliding window has to get right over a fixed one:
// a fixed window would admit a fresh full batch of MAX_REQUESTS the instant
// the clock crosses into a new window, even though 19 of the last 20 hits
// are still recent. A sliding window only ever opens up exactly as many
// slots as have actually aged out - here, exactly one.
test("aging out the single oldest hit admits exactly one more request, not a fresh batch", () => {
  const store = new Map<string, number[]>();
  const start = Date.now();

  for (let i = 0; i < MAX_REQUESTS; i += 1) {
    checkAndRecord(store, "1.1.1.1", start + i, WINDOW_MS, MAX_REQUESTS);
  }
  assert.equal(
    checkAndRecord(store, "1.1.1.1", start, WINDOW_MS, MAX_REQUESTS).limited,
    true,
  );

  // At `now = start + WINDOW_MS`, the oldest hit (age exactly WINDOW_MS)
  // ages out - the prune keeps only ages strictly less than WINDOW_MS - while
  // the second-oldest (age WINDOW_MS - 1) is still just inside the window.
  const justAfterOldestExpires = start + WINDOW_MS;

  const opened = checkAndRecord(
    store,
    "1.1.1.1",
    justAfterOldestExpires,
    WINDOW_MS,
    MAX_REQUESTS,
  );
  assert.equal(opened.limited, false, "exactly one slot should have opened up");

  const stillBlocked = checkAndRecord(
    store,
    "1.1.1.1",
    justAfterOldestExpires,
    WINDOW_MS,
    MAX_REQUESTS,
  );
  assert.equal(
    stillBlocked.limited,
    true,
    "a second request at the same instant should not also get through",
  );
});

test("reset time rounds up to whole minutes and pluralizes correctly", () => {
  const store = new Map<string, number[]>();
  const start = Date.now();

  for (let i = 0; i < MAX_REQUESTS; i += 1) {
    checkAndRecord(store, "1.1.1.1", start, WINDOW_MS, MAX_REQUESTS);
  }

  // 1 second before the oldest hit ages out: less than a minute of real
  // time left, but a partial minute still has to round up to "1 minute",
  // not "0 minutes" (which would tell a still-blocked user they're clear).
  const almostReset = start + WINDOW_MS - 1000;
  const result = checkAndRecord(store, "1.1.1.1", almostReset, WINDOW_MS, MAX_REQUESTS);
  assert.equal(result.limited, true);
  assert.equal(result.limited && result.resetInMinutes, 1);
});

test("a store that grows stale entries evicts them on the next check", () => {
  const store = new Map<string, number[]>();
  const start = Date.now();

  checkAndRecord(store, "1.1.1.1", start, WINDOW_MS, MAX_REQUESTS);
  assert.equal(store.has("1.1.1.1"), true);

  // A later check for a different IP, well past the first IP's window,
  // should sweep the stale entry rather than leaving it to grow forever.
  checkAndRecord(store, "2.2.2.2", start + WINDOW_MS + 1, WINDOW_MS, MAX_REQUESTS);
  assert.equal(store.has("1.1.1.1"), false);
});
