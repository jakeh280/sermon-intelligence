import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIP_CEIL_SEC,
  CLIP_FLOOR_SEC,
  formatDurationSec,
  snapClipSec,
} from "../lib/clipRange.ts";
import { parseHistory } from "../lib/history.ts";
import {
  isClipsSectionTitle,
  parseBentoSections,
  parseClipOptions,
} from "../lib/outputParsing.ts";

test("clip bounds snap and clamp", () => {
  assert.equal(snapClipSec(17), 15);
  assert.equal(snapClipSec(18), 20);
  assert.equal(snapClipSec(-200), CLIP_FLOOR_SEC);
  assert.equal(snapClipSec(900), CLIP_CEIL_SEC);
});

test("durations use compact readable labels", () => {
  assert.equal(formatDurationSec(45), "45s");
  assert.equal(formatDurationSec(60), "1m");
  assert.equal(formatDurationSec(125), "2m 5s");
});

test("markdown sections preserve a preamble and headings", () => {
  const sections = parseBentoSections(
    "\uFEFFUseful opening\n\n### Titles\nOne\n\n### Description\nTwo",
  );
  assert.deepEqual(sections, [
    { title: "Draft", body: "Useful opening" },
    { title: "Titles", body: "One" },
    { title: "Description", body: "Two" },
  ]);
});

test("structured clips tolerate bold labels and multiline fields", () => {
  const parsed = parseClipOptions(`A short preamble.

Option 1
**Timestamps**: 01:20 to 02:05
**Duration**: 45 seconds
**Title**: A Useful Moment
**Transcript**: First line
continues here
**Why it works**: Clear tension

Option 2
Title: Second Moment
Description: Plain labels also work`);

  assert.equal(parsed.preamble, "A short preamble.");
  assert.equal(parsed.clips.length, 2);
  assert.equal(parsed.clips[0]?.Transcript, "First line continues here");
  assert.equal(parsed.clips[1]?.Title, "Second Moment");
  assert.equal(parsed.clips[1]?.Description, "Plain labels also work");
});

test("clip section matching is specific", () => {
  assert.equal(isClipsSectionTitle("Clips for Social"), true);
  assert.equal(isClipsSectionTitle("Longer Clips"), false);
});

test("history parsing discards corruption instead of crashing the page", () => {
  assert.deepEqual(parseHistory("not json"), []);
  assert.deepEqual(parseHistory('{"wrong":true}'), []);
  const parsed = parseHistory(JSON.stringify([
    {
      id: "good",
      timestamp: 1,
      label: "Sunday",
      output: "Result",
      clipMinSec: 15,
      clipMaxSec: 120,
    },
    { id: "broken" },
  ]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.id, "good");
});
