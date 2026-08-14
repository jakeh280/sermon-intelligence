import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBentoSections,
  parseClipOptions,
  splitClipOptionBlocks,
} from "../lib/outputParsing.ts";

// Synthetic model output only. These fixtures stand in for formatting the model
// drifts into, which is why none of them are word for word the prompt's example.

test("option headers survive bold, headings, bullets and punctuation", () => {
  const variants = [
    "Option 1",
    "**Option 1**",
    "Option 1:",
    "**Option 1:**",
    "#### Option 1",
    "- Option 1",
    "Option 1.",
    "OPTION 1",
    "  Option 1  ",
    "Option #1",
    "Clip 1",
  ];

  for (const header of variants) {
    const { blocks } = splitClipOptionBlocks(
      `${header}\nTitle: Synthetic clip title`,
    );
    assert.equal(blocks.length, 1, header);
  }
});

test("option headers past the third are not dropped", () => {
  const { blocks } = splitClipOptionBlocks(
    ["Option 1", "Option 2", "Option 3", "Option 4"].join("\n"),
  );
  assert.equal(blocks.length, 4);
});

test("a header has to be the whole line, so quoted text never splits a clip", () => {
  const body = `Option 1
Title: Synthetic clip title
Transcript: We had to pick option 1 that morning
Description: Option 2 was never really on the table`;

  const { clips } = parseClipOptions(body);
  assert.equal(clips.length, 1);
  assert.equal(
    clips[0]?.Transcript,
    "We had to pick option 1 that morning",
  );
});

test("field labels survive bold on either side of the colon", () => {
  const body = `Option 1
**Timestamps**: 01:20 to 02:05
**Duration:** 45 seconds
Title : Synthetic clip title
- **Transcript**: Synthetic verbatim line
* Description: Synthetic context line
**Why it works:** Synthetic reason`;

  const { clips } = parseClipOptions(body);
  const clip = clips[0];
  assert.equal(clip?.Timestamps, "01:20 to 02:05");
  assert.equal(clip?.Duration, "45 seconds");
  assert.equal(clip?.Title, "Synthetic clip title");
  assert.equal(clip?.Transcript, "Synthetic verbatim line");
  assert.equal(clip?.Description, "Synthetic context line");
  assert.equal(clip?.["Why it works"], "Synthetic reason");
});

test("near miss field labels still fill the card", () => {
  const body = `Option 1
Timestamp: 01:20 to 02:05
Length: 45 seconds
Hook: Synthetic clip title
Quote: Synthetic verbatim line
Context: Synthetic context line
Why this works: Synthetic reason`;

  const clip = parseClipOptions(body).clips[0];
  assert.equal(clip?.Timestamps, "01:20 to 02:05");
  assert.equal(clip?.Duration, "45 seconds");
  assert.equal(clip?.Title, "Synthetic clip title");
  assert.equal(clip?.Transcript, "Synthetic verbatim line");
  assert.equal(clip?.Description, "Synthetic context line");
  assert.equal(clip?.["Why it works"], "Synthetic reason");
});

test("prose is not mistaken for a label without a colon", () => {
  const body = `Option 1
Transcript: Title deeds were handed over that day
Duration mattered less than the moment`;

  const clip = parseClipOptions(body).clips[0];
  assert.equal(
    clip?.Transcript,
    "Title deeds were handed over that day Duration mattered less than the moment",
  );
  assert.equal(clip?.Title, undefined);
  assert.equal(clip?.Duration, undefined);
});

test("option labels are cleaned of markdown for display", () => {
  const { clips } = parseClipOptions("**Option 2:**\nTitle: Synthetic title");
  assert.equal(clips[0]?.optionLabel, "Option 2");
});

test("sections fall back to h2 when the model skips h3 entirely", () => {
  const sections = parseBentoSections(
    "## Titles\nSynthetic title\n\n## Clips\nOption 1\nTitle: Synthetic",
  );
  assert.deepEqual(
    sections.map((section) => section.title),
    ["Titles", "Clips"],
  );
});

test("h4 subheadings inside h2 sections do not shred the response", () => {
  const sections = parseBentoSections(
    "## Titles\nSynthetic title\n\n## Clips\n#### Option 1\nTitle: Synthetic",
  );
  assert.equal(sections.length, 2);
  assert.match(sections[1]?.body ?? "", /#### Option 1/);
});

test("well formed h3 output ignores the fallback", () => {
  const sections = parseBentoSections(
    "### Titles\nSynthetic title\n\n#### A subheading\nStill inside titles",
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.title, "Titles");
  assert.match(sections[0]?.body ?? "", /#### A subheading/);
});

test("a response with no headings at all stays a single draft section", () => {
  const sections = parseBentoSections("Synthetic prose with no headings.");
  assert.deepEqual(sections, [
    { title: "Draft", body: "Synthetic prose with no headings." },
  ]);
});

test("chapters heading-ified one per line are folded back into one Chapters card", () => {
  // Reproduces the shape seen in production: the model starts every chapter
  // with "### " too, leaving "### Chapters" empty and each chapter as its own
  // near-empty section instead of a list under it.
  const sections = parseBentoSections(
    "### Titles\nSynthetic title\n\n### Chapters\n\n### 00:00 Introduction\n\n### 02:00 When the Brook Dries Up\n\n### Clips\nOption 1\nTitle: Synthetic",
  );
  assert.deepEqual(
    sections.map((section) => section.title),
    ["Titles", "Chapters", "Clips"],
  );
  const chapters = sections.find((section) => section.title === "Chapters");
  assert.equal(
    chapters?.body,
    "- 00:00 Introduction\n- 02:00 When the Brook Dries Up",
  );
});

test("a stray heading with its own body keeps that body on the merged line", () => {
  // Confirmed separately (remark-parse + remark-gfm) that this unindented
  // continuation line is a GFM lazy continuation: it stays part of the
  // "02:00" list item's paragraph rather than breaking the list, so the
  // leaked sentence renders attached to its chapter instead of shredding it.
  const sections = parseBentoSections(
    "### Chapters\n- 00:00 Introduction\n\n### 02:00 A Chapter With Body\nExtra sentence that leaked under the stray heading.\n\n### Clips\nOption 1\nTitle: Synthetic",
  );
  const chapters = sections.find((section) => section.title === "Chapters");
  assert.equal(
    chapters?.body,
    "- 00:00 Introduction\n- 02:00 A Chapter With Body\nExtra sentence that leaked under the stray heading.",
  );
});

test("a stray heading before any canonical section is kept as its own card", () => {
  // No prior section to fold into, so this is left alone rather than dropped.
  const sections = parseBentoSections("### 00:00 Introduction\nSynthetic body.");
  assert.deepEqual(sections, [
    { title: "00:00 Introduction", body: "Synthetic body." },
  ]);
});

test("heading-ified chapters are also merged through the h2 fallback path", () => {
  const sections = parseBentoSections(
    "## Chapters\n\n## 00:00 Introduction\n\n## Clips\nOption 1\nTitle: Synthetic",
  );
  assert.deepEqual(
    sections.map((section) => section.title),
    ["Chapters", "Clips"],
  );
  assert.equal(
    sections.find((section) => section.title === "Chapters")?.body,
    "- 00:00 Introduction",
  );
});
