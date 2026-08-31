import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIP_CEIL_SEC,
  CLIP_FLOOR_SEC,
  formatDurationSec,
  parseClipBounds,
  snapClipSec,
} from "../lib/clipRange.ts";
import { parseHistory } from "../lib/history.ts";
import {
  isClipsSectionTitle,
  parseBentoSections,
  parseClipOptions,
} from "../lib/outputParsing.ts";
import { normalizeTranscript } from "../lib/transcript.ts";

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

test("API clip bounds use the shared slider rules", () => {
  assert.deepEqual(
    parseClipBounds({ clipMinSec: 18, clipMaxSec: 123 }),
    { min: 20, max: 125 },
  );
  assert.deepEqual(
    parseClipBounds({ clipMinSec: -10, clipMaxSec: 900 }),
    { min: CLIP_FLOOR_SEC, max: CLIP_CEIL_SEC },
  );
  assert.equal(parseClipBounds({ clipMinSec: 120, clipMaxSec: 15 }), null);
  assert.equal(parseClipBounds({ clipMinSec: "15", clipMaxSec: 120 }), null);
  assert.equal(parseClipBounds(null), null);
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

test("Premiere transcript blocks become prompt timestamp tags", () => {
  const premiere = `00:00:00:03 - 00:00:23:14
Unknown
Synthetic opening sentence for transcript normalization.

00:00:23:16 - 00:00:48:21
Unknown
Synthetic second sentence for transcript normalization.`;
  assert.equal(
    normalizeTranscript(premiere),
    `[00:00:00:03]
Synthetic opening sentence for transcript normalization.

[00:00:23:16]
Synthetic second sentence for transcript normalization.`,
  );
});

test("plain and already tagged transcripts pass through", () => {
  const tagged = "\uFEFF[00:01:02:03]\r\nAlready ready.\r\n\r\n\r\n";
  const plain = "  Plain transcript text.  \r\n\r\nSecond paragraph.\r\n";
  assert.equal(normalizeTranscript(tagged), tagged);
  assert.equal(normalizeTranscript(plain), plain);
});

test("SRT cues become prompt timestamp tags", () => {
  const srt = "1\r\n00:00:01,000 --> 00:00:03,000\r\nSynthetic caption text.\r\n";
  assert.equal(
    normalizeTranscript(srt),
    "[00:00:01:00]\nSynthetic caption text.",
  );
});

test("mixed tagged and Premiere blocks preserve useful speaker labels", () => {
  const mixed = `[00:00:01:02]
Already tagged text.

00:00:10:00 - 00:00:20:00
Pastor
Named speaker text.

00:00:20:01 - 00:00:30:00

UNKNOWN
Unknown speaker text.`;
  assert.equal(
    normalizeTranscript(mixed),
    `[00:00:01:02]
Already tagged text.

[00:00:10:00]
Pastor
Named speaker text.

[00:00:20:01]

Unknown speaker text.`,
  );
});
