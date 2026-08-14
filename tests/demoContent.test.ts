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

test("the demo's Titles section is a real markdown list, not bare lines", () => {
  // TitlesBentoCard's three-across card layout (app/page.tsx) only fires when
  // remark actually parses the body as a list. A caught regression: the first
  // frozen draft had bare "Option 1: ..." lines with no leading "- ", which
  // rendered as a single paragraph instead of three styled cards. Confirmed
  // against the live page (0 <li> elements) before this test was added.
  const titlesBody = parseBentoSections(DEMO_OUTPUT).find(
    (section) => section.title === "Titles",
  )?.body;
  assert.ok(titlesBody, "Titles section is missing");
  const lines = titlesBody.trim().split("\n");
  assert.equal(lines.length, 3, "expected exactly 3 title options");
  for (const line of lines) {
    assert.match(line, /^-\s+Option \d/, `not a list item: "${line}"`);
  }
});
