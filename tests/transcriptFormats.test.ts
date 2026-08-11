import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTranscript } from "../lib/transcript.ts";

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

test("caption formats are never mistaken for Premiere ranges", () => {
  const srt = "1\r\n00:00:01,000 --> 00:00:03,000\r\nSynthetic caption text.\r\n";
  const vtt =
    "WEBVTT\r\n\r\n00:00:01.000 --> 00:00:03.000\r\nSynthetic caption text.\r\n";
  assert.equal(normalizeTranscript(srt), srt);
  assert.equal(normalizeTranscript(vtt), vtt);
});

test("normalizing an already normalized transcript changes nothing", () => {
  const fixtures = [
    "00:00:00:03 - 00:00:23:14\nUnknown\nSynthetic frame fixture.",
    "00:00:00;03 - 00:00:23;14\nUnknown\nSynthetic drop frame fixture.",
    "00:00:00.030 - 00:00:23.140\nUnknown\nSynthetic millisecond fixture.",
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
