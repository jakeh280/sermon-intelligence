import assert from "node:assert/strict";
import test from "node:test";
import { verifyClipTiming } from "../lib/verifiedClips.ts";

const generated = (quote: string) => `### Titles\n\nA title\n\n### Clips\n\nOption 1\nTimestamps: 00:36 - 00:48\nDuration: 12 seconds\nTitle: A clip\nTranscript: ${quote}\nDescription: A description\nWhy it works: A reason`;

test("a source marker replaces an invented model timestamp", () => {
  const result = verifyClipTiming(generated("Second synthetic sentence."), "[00:00:00:00] First synthetic sentence. [00:01:00:00] Second synthetic sentence.");
  assert.match(result, /From source marker 01:00/);
  assert.doesNotMatch(result, /00:36|00:48|12 seconds/);
  assert.match(result, /Duration: Not available/);
});

test("matching a complete caption uses its supplied boundaries", () => {
  const source = "1\n00:01:00,000 --> 00:01:20,000\nSecond synthetic sentence.\n";
  const result = verifyClipTiming(generated("Second synthetic sentence."), source);
  assert.match(result, /01:00 - 01:20 \(source segment boundaries, approximate\)/);
  assert.match(result, /Approximately 20 seconds/);
});

test("partial, repeated, and altered quotes do not get invented timing", () => {
  const source = "[00:00:00:00] A repeated sentence. [00:01:00:00] A repeated sentence.";
  for (const quote of ["A repeated sentence.", "A changed sentence."]) {
    const result = verifyClipTiming(generated(quote), source);
    assert.match(result, /passage could not be matched uniquely/);
    assert.doesNotMatch(result, /00:36|00:48/);
  }
  const partial = verifyClipTiming(generated("synthetic sentence."), "1\n00:01:00,000 --> 00:01:20,000\nSecond synthetic sentence.\n");
  assert.match(partial, /From source marker 01:00/);
  assert.match(partial, /Duration: Not available/);
});

test("untimed and unstructured responses do not expose model clip timestamps", () => {
  assert.match(verifyClipTiming(generated("A sentence."), "A sentence."), /passage could not be matched uniquely/);
  assert.doesNotMatch(verifyClipTiming("Timestamps: 00:36 - 00:48", "A sentence."), /00:36/);
});
