import assert from "node:assert/strict";
import test from "node:test";

import { hasTimestampTags, normalizeTranscript } from "../lib/transcript.ts";

// Every fixture here is synthetic. No church transcript text belongs in this repo.

test("drop frame exports using semicolon frames become prompt tags", () => {
  const premiere = `00:00:00;03 - 00:00:23;14
Unknown
Synthetic opening sentence for drop frame coverage.

00:00:23;16 - 00:00:48;21
Unknown
Synthetic second sentence for drop frame coverage.`;
  assert.equal(
    normalizeTranscript(premiere),
    `[00:00:00:03]
Synthetic opening sentence for drop frame coverage.

[00:00:23:16]
Synthetic second sentence for drop frame coverage.`,
  );
});

test("millisecond exports keep the clock and zero the ignored frames", () => {
  const dotted = `00:01:02.500 - 00:01:09.750
Unknown
Synthetic sentence for millisecond coverage.`;
  const comma = `00:01:02,500 - 00:01:09,750
Unknown
Synthetic sentence for millisecond coverage.`;
  const expected = `[00:01:02:00]
Synthetic sentence for millisecond coverage.`;

  assert.equal(normalizeTranscript(dotted), expected);
  assert.equal(normalizeTranscript(comma), expected);
});

test("DaVinci Resolve ranges wrapped in brackets become prompt tags", () => {
  const resolve = `[00:00:00:11 - 00:00:13:03]
Synthetic opening sentence for DaVinci Resolve coverage.

[00:00:14:08 - 00:00:45:04]
Synthetic second sentence for DaVinci Resolve coverage.`;
  assert.equal(
    normalizeTranscript(resolve),
    `[00:00:00:11]
Synthetic opening sentence for DaVinci Resolve coverage.

[00:00:14:08]
Synthetic second sentence for DaVinci Resolve coverage.`,
  );
});

test("bracketed DaVinci Resolve ranges also accept drop frame and millisecond variants", () => {
  const dropFrame = `[00:00:00;03 - 00:00:23;14]
Synthetic drop frame line.`;
  assert.equal(
    normalizeTranscript(dropFrame),
    `[00:00:00:03]
Synthetic drop frame line.`,
  );

  const milliseconds = `[00:01:02.500 - 00:01:09.750]
Synthetic millisecond line.`;
  assert.equal(
    normalizeTranscript(milliseconds),
    `[00:01:02:00]
Synthetic millisecond line.`,
  );
});

test("a single export may mix frame and millisecond notation", () => {
  const mixed = `00:00:05:00 - 00:00:10:00
Unknown
Synthetic frame notation line.

00:00:10;01 - 00:00:15;00
Unknown
Synthetic drop frame line.

00:00:15.001 - 00:00:20.000
Unknown
Synthetic millisecond line.`;
  assert.equal(
    normalizeTranscript(mixed),
    `[00:00:05:00]
Synthetic frame notation line.

[00:00:10:01]
Synthetic drop frame line.

[00:00:15:00]
Synthetic millisecond line.`,
  );
});

test("mixed speaker labels keep names and drop only unknown markers", () => {
  const speakers = `00:00:01:00 - 00:00:05:00
Pastor Sam
Synthetic named speaker line.

00:00:05:01 - 00:00:09:00
Speaker 1
Synthetic numbered speaker line.

00:00:09:01 - 00:00:12:00
unknown
Synthetic lowercase unknown line.

00:00:12:01 - 00:00:15:00
Unknown:
Synthetic trailing colon unknown line.`;
  assert.equal(
    normalizeTranscript(speakers),
    `[00:00:01:00]
Pastor Sam
Synthetic named speaker line.

[00:00:05:01]
Speaker 1
Synthetic numbered speaker line.

[00:00:09:01]
Synthetic lowercase unknown line.

[00:00:12:01]
Synthetic trailing colon unknown line.`,
  );
});

test("blank speaker blocks survive without swallowing the next line", () => {
  const blanks = `00:00:01:00 - 00:00:05:00

Synthetic line after a blank speaker slot.

00:00:05:01 - 00:00:09:00


Unknown
Synthetic line after two blank lines.`;
  assert.equal(
    normalizeTranscript(blanks),
    `[00:00:01:00]

Synthetic line after a blank speaker slot.

[00:00:05:01]


Synthetic line after two blank lines.`,
  );
});

test("consecutive ranges and a trailing range stay intact", () => {
  const edges = `00:00:01:00 - 00:00:05:00
00:00:05:01 - 00:00:09:00
Synthetic line under the second range.

00:00:09:01 - 00:00:12:00`;
  assert.equal(
    normalizeTranscript(edges),
    `[00:00:01:00]
[00:00:05:01]
Synthetic line under the second range.

[00:00:09:01]`,
  );
});

test("malformed ranges pass through untouched rather than half converted", () => {
  const malformed = [
    "00:00:10:00 - ",
    "00:0:10:00 - 00:00:20:00",
    "00:00:10:00 -> 00:00:20:00",
    "00:00:10:00-00:00:20:00",
    "00:00:10 - 00:00:20",
    "00:00:10:000 - 00:00:20:000",
  ];
  for (const range of malformed) {
    const input = `${range}\nSynthetic line under a malformed range.`;
    assert.equal(normalizeTranscript(input), input, range);
  }
});

test("caption cues are converted through the caption path, not the range path", () => {
  const srt = `1
00:00:01,000 --> 00:00:03,000
Synthetic first caption.

2
00:00:03,500 --> 00:00:07,250
Synthetic second caption.`;
  assert.equal(
    normalizeTranscript(srt),
    `[00:00:01:00]
Synthetic first caption.

[00:00:03:00]
Synthetic second caption.`,
  );

  const vtt = `WEBVTT
Kind: captions
Language: en

NOTE This block is metadata and is dropped.

00:00:01.000 --> 00:00:03.000 align:start position:0%
Synthetic first caption.

00:01:02.500 --> 00:01:09.750
Synthetic second caption.`;
  assert.equal(
    normalizeTranscript(vtt),
    `[00:00:01:00]
Synthetic first caption.

[00:01:02:00]
Synthetic second caption.`,
  );
});

test("caption cue text is preserved verbatim, including inline markup", () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
<v Pastor Sam>Synthetic <i>emphasised</i> caption.
Second line of the same cue.`;
  assert.equal(
    normalizeTranscript(vtt),
    `[00:00:01:00]
<v Pastor Sam>Synthetic <i>emphasised</i> caption.
Second line of the same cue.`,
  );
});

test("short form WebVTT timestamps without hours are placed correctly", () => {
  const vtt = "WEBVTT\n\n12:05.500 --> 12:09.000\nSynthetic caption text.";
  assert.equal(
    normalizeTranscript(vtt),
    "[00:12:05:00]\nSynthetic caption text.",
  );
});

test("caption files this cannot account for pass through untouched", () => {
  const cueIdentifier = `WEBVTT

intro-cue
00:00:01.000 --> 00:00:03.000
Synthetic caption text.`;

  const noBlankLines = `1
00:00:01,000 --> 00:00:03,000
Synthetic first caption.
2
00:00:03,500 --> 00:00:07,250
Synthetic second caption.`;

  const emptyCue = `1
00:00:01,000 --> 00:00:03,000

2
00:00:03,500 --> 00:00:07,250
Synthetic second caption.`;

  const strayProse = `Some notes before the captions.

1
00:00:01,000 --> 00:00:03,000
Synthetic caption text.`;

  for (const input of [cueIdentifier, noBlankLines, emptyCue, strayProse]) {
    assert.equal(normalizeTranscript(input), input);
  }
});

test("plain text containing an arrow is not treated as captions", () => {
  const prose = "We moved from doubt --> to trust that morning.";
  assert.equal(normalizeTranscript(prose), prose);
});

test("normalizing an already normalized transcript changes nothing", () => {
  const fixtures = [
    "00:00:00:03 - 00:00:23:14\nUnknown\nSynthetic frame fixture.",
    "00:00:00;03 - 00:00:23;14\nUnknown\nSynthetic drop frame fixture.",
    "00:00:00.030 - 00:00:23.140\nUnknown\nSynthetic millisecond fixture.",
    "[00:00:00:03 - 00:00:23:14]\nSynthetic DaVinci Resolve fixture.",
    "1\n00:00:01,000 --> 00:00:03,000\nSynthetic SRT fixture.",
    "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nSynthetic WebVTT fixture.",
  ];
  for (const fixture of fixtures) {
    const once = normalizeTranscript(fixture);
    assert.equal(normalizeTranscript(once), once, fixture);
  }
});

test("a very long single line does not stall the range matcher", () => {
  const longLine = `Synthetic ${"sentence ".repeat(50_000)}`;
  const input = `00:00:01:00 - 00:00:05:00\nUnknown\n${longLine}`;
  assert.equal(normalizeTranscript(input), `[00:00:01:00]\n${longLine}`);
});

test("very long caption files convert every cue", () => {
  const cues = 20_000;
  const input = Array.from({ length: cues }, (_, i) => {
    const start = String(i % 60).padStart(2, "0");
    const end = String((i + 1) % 60).padStart(2, "0");
    return `${i + 1}\n00:00:${start},000 --> 00:00:${end},000\nSynthetic cue line ${i}.`;
  }).join("\n\n");

  const lines = normalizeTranscript(input).split("\n");
  const tags = lines.filter((line) => /^\[\d{2}:\d{2}:\d{2}:00\]$/.test(line));

  assert.equal(tags.length, cues);
  assert.equal(lines[0], "[00:00:00:00]");
  assert.equal(lines[1], "Synthetic cue line 0.");
  assert.equal(lines[lines.length - 1], `Synthetic cue line ${cues - 1}.`);
});

test("hasTimestampTags is false for a transcript with no timing at all", () => {
  // The shape a "whole text" transcription export produces: one continuous
  // block of prose, no timestamps anywhere, not even a newline.
  const untimed =
    "Synthetic sermon prose with no timestamps anywhere in it at all.";
  assert.equal(hasTimestampTags(normalizeTranscript(untimed)), false);
});

test("hasTimestampTags is true once a transcript normalizes to prompt tags", () => {
  const premiere = "00:00:00:03 - 00:00:23:14\nSynthetic sentence.";
  assert.equal(hasTimestampTags(normalizeTranscript(premiere)), true);

  const resolve = "[00:00:00:11 - 00:00:13:03]\nSynthetic sentence.";
  assert.equal(hasTimestampTags(normalizeTranscript(resolve)), true);

  const srt = "1\n00:00:01,000 --> 00:00:03,000\nSynthetic sentence.";
  assert.equal(hasTimestampTags(normalizeTranscript(srt)), true);
});

test("hasTimestampTags is false for a caption file this cannot account for", () => {
  // normalizeTranscript passes this through untouched (all or nothing), so
  // it should read the same as any other untimed plain text.
  const noBlankLines =
    "1\n00:00:01,000 --> 00:00:03,000\nSynthetic first caption.\n2\n00:00:03,500 --> 00:00:07,250\nSynthetic second caption.";
  assert.equal(hasTimestampTags(normalizeTranscript(noBlankLines)), false);
});

test("very long transcripts normalize every block", () => {
  const blocks = 20_000;
  const input = Array.from({ length: blocks }, (_, i) => {
    const start = String(i % 60).padStart(2, "0");
    const end = String((i + 1) % 60).padStart(2, "0");
    return `00:00:${start}:00 - 00:00:${end}:00\nUnknown\nSynthetic body line ${i}.`;
  }).join("\n\n");

  const normalized = normalizeTranscript(input);
  const lines = normalized.split("\n");
  const tags = lines.filter((line) => /^\[\d{2}:\d{2}:\d{2}:\d{2}\]$/.test(line));

  assert.equal(tags.length, blocks);
  assert.equal(lines[0], "[00:00:00:00]");
  assert.equal(lines[1], "Synthetic body line 0.");
  assert.equal(lines[lines.length - 1], `Synthetic body line ${blocks - 1}.`);
  assert.equal(normalized.includes("Unknown"), false);
});
