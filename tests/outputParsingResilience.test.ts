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

test("a field label alias inside the quoted transcript does not truncate it", () => {
  // "Why:" appears mid quote, one field early (before Description), via the
  // loose "Why" alias rather than the literal "Why it works" label. It must
  // stay part of the Transcript instead of silently starting a new field
  // and losing everything after it.
  const body = `Option 1
Title: Original title
Transcript: Opening words
Why: because we need grace
Closing words
Description: Context
Why it works: Complete thought`;

  const clip = parseClipOptions(body).clips[0];
  assert.equal(
    clip?.Transcript,
    "Opening words Why: because we need grace Closing words",
  );
  assert.equal(clip?.Description, "Context");
  assert.equal(clip?.["Why it works"], "Complete thought");
});

test("a field label alias that would move backward stays with the quote instead", () => {
  const body = `Option 1
Transcript: He said now is the time
Time: to move forward
Description: Context
Why it works: Reason`;

  const clip = parseClipOptions(body).clips[0];
  assert.equal(clip?.Transcript, "He said now is the time Time: to move forward");
  assert.equal(clip?.Description, "Context");
});

test("the exact next-field label always transitions, even mid-quote", () => {
  // A quote that happens to contain the *literal*, correctly-positioned next
  // label is indistinguishable from a real field boundary, so this is not a
  // case the parser can rescue - the fix only targets out-of-order aliases.
  const body = `Option 1
Transcript: First part
Description: Second part`;

  const clip = parseClipOptions(body).clips[0];
  assert.equal(clip?.Transcript, "First part");
  assert.equal(clip?.Description, "Second part");
});

test("fields out of the prompt's order still all land, not just the first one", () => {
  // The out-of-order guard above must not mistake a model that emits the six
  // fields in a different order (still each exactly once) for a quote
  // collision, which would wrongly swallow every field after the first
  // reordered one into the field that was open at the time.
  const body = `Option 1
Title: X
Timestamps: 00:00 - 00:10
Duration: 10 seconds
Transcript: Verbatim quote text
Description: Some context
Why it works: A reason`;

  const clip = parseClipOptions(body).clips[0];
  assert.equal(clip?.Title, "X");
  assert.equal(clip?.Timestamps, "00:00 - 00:10");
  assert.equal(clip?.Duration, "10 seconds");
  assert.equal(clip?.Transcript, "Verbatim quote text");
  assert.equal(clip?.Description, "Some context");
  assert.equal(clip?.["Why it works"], "A reason");
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

test("a heading-shaped line inside a fenced code block does not split the section", () => {
  // A quoted excerpt inside a fence coincidentally starting a line with
  // "### " (or "## ") must stay part of the section it's fenced inside,
  // not become a section boundary of its own.
  const sections = parseBentoSections(
    "### Chapters\n00:00 Start\n\n```\n### Not A Real Section\nJust quoted text inside a fence.\n```\n\n### Clips\nOption 1\nTitle: Synthetic",
  );
  assert.deepEqual(
    sections.map((section) => section.title),
    ["Chapters", "Clips"],
  );
  assert.match(
    sections.find((section) => section.title === "Chapters")?.body ?? "",
    /```\n### Not A Real Section\nJust quoted text inside a fence\.\n```/,
  );
});

test("an unpaired fence delimiter masks nothing rather than swallowing the rest of the response", () => {
  // If the fence never closes, treating everything after it as "inside the
  // fence" would mask every real heading that follows - turning this
  // hardening into something that shreds a well formed response worse than
  // leaving an unclosed fence unmasked ever did.
  const sections = parseBentoSections(
    "### Titles\nSynthetic title\n\n### Description\n```\nan unpaired fence starts here and never closes\n\n### Chapters\n00:00 Start\n\n### Clips\nOption 1\nTitle: Synthetic",
  );
  assert.deepEqual(
    sections.map((section) => section.title),
    ["Titles", "Description", "Chapters", "Clips"],
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

test("a nested h3 inside h2 sections does not block the h2 fallback from recovering them", () => {
  // Reproduces a shape a model can actually emit: it uses "## " for the four
  // real sections but then heading-ifies a clip option as "### Option 1".
  // The lone "###" heading used to count as "the response has headings",
  // which stopped the "##" fallback from ever running and left everything
  // before "### Option 1" as one undifferentiated Draft section.
  const sections = parseBentoSections(
    "## Titles\nSynthetic title\n\n## Description\nSynthetic description\n\n## Chapters\n00:00 Start\n\n## Clips\n### Option 1\nTitle: Synthetic",
  );
  assert.deepEqual(
    sections.map((section) => section.title),
    ["Titles", "Description", "Chapters", "Clips"],
  );
  const { clips } = parseClipOptions(
    sections.find((section) => section.title === "Clips")?.body ?? "",
  );
  assert.equal(clips.length, 1);
  assert.equal(clips[0]?.Title, "Synthetic");
});

test("sibling sections at different heading levels are both recovered, not just one pair", () => {
  // A model that uses "### " for two of the four real sections and "## " for
  // the other two (not nested inside one another - genuine siblings at
  // different levels) used to tie 2-canonical-sections-recovered against
  // 2-canonical-sections-recovered between the old strict/relaxed passes,
  // and the tie-break kept only one pair - swallowing the other pair's
  // content whole into the section before it.
  const sections = parseBentoSections(
    "### Titles\nSynthetic titles\n\n### Description\nSynthetic description\n\n## Chapters\n00:00 Start\n\n## Clips\nOption 1\nTitle: Synthetic",
  );
  assert.deepEqual(
    sections.map((section) => section.title),
    ["Titles", "Description", "Chapters", "Clips"],
  );
  assert.equal(
    sections.find((section) => section.title === "Description")?.body,
    "Synthetic description",
  );
});
