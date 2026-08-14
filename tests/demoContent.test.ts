import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_ATTRIBUTION, DEMO_LABEL, DEMO_OUTPUT } from "../lib/demoContent.ts";
import { describeOutputIssues } from "../lib/outputHealth.ts";
import { parseBentoSections } from "../lib/outputParsing.ts";

// DEMO_OUTPUT is a frozen, hand-checked asset (see lib/demoContent.ts), not
// live model output. These tests exist to catch a careless hand edit, not to
// re-verify the model: reformatting for readability could reintroduce the
// section-shredding bug, or a copy edit could reintroduce a banned filler
// phrase, without either mistake being visible just by reading the prose.

test("the demo output has no health issues", () => {
  assert.deepEqual(describeOutputIssues(DEMO_OUTPUT), []);
});

test("the demo output parses into exactly the four canonical sections", () => {
  const sections = parseBentoSections(DEMO_OUTPUT);
  assert.deepEqual(
    sections.map((section) => section.title),
    ["Titles", "Description", "Chapters", "Clips"],
  );
});

test("the demo output avoids the banned introductory filler phrases", () => {
  const banned = [
    "we explore",
    "we look at",
    "join us",
    "we discover that",
    "we learn that",
    "we find that",
    "this sermon",
    "in this message",
  ];
  const lower = DEMO_OUTPUT.toLowerCase();
  for (const phrase of banned) {
    assert.equal(lower.includes(phrase), false, `found banned phrase: "${phrase}"`);
  }
});

test("the demo has an attribution label and a real church link", () => {
  assert.match(DEMO_LABEL, /Pastor Jay Stewart/);
  assert.equal(DEMO_ATTRIBUTION.url, "https://therefuge.net");
});
