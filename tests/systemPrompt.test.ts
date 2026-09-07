import assert from "node:assert/strict";
import test from "node:test";

import { buildSystemPrompt } from "../lib/systemPrompt.ts";

test("a timed transcript keeps the fabrication-forbidding rules out", () => {
  const prompt = buildSystemPrompt(15, 120, true);
  assert.match(prompt, /TIMESTAMP CONVERSION/);
  assert.match(prompt, /METADATA ANCHOR RULE/);
  assert.match(prompt, /STRICT DURATION RULE/);
  assert.doesNotMatch(prompt, /NO TIMESTAMPS IN SOURCE/);
});

test("an untimed transcript forbids inventing chapter and clip times", () => {
  const prompt = buildSystemPrompt(15, 120, false);
  assert.match(prompt, /NO TIMESTAMPS IN SOURCE/);
  assert.match(prompt, /Not available \(source transcript has no timestamps\)/);
  // The rules that only make sense with real timing must not survive: a model
  // that still sees "METADATA ANCHOR RULE" or "STRICT DURATION RULE" has a
  // rule telling it to report a time it has no basis for.
  assert.doesNotMatch(prompt, /METADATA ANCHOR RULE/);
  assert.doesNotMatch(prompt, /STRICT DURATION RULE/);
  assert.doesNotMatch(prompt, /TIMESTAMP CONVERSION/);
});

test("the clip duration bounds still appear for a timed transcript", () => {
  const prompt = buildSystemPrompt(30, 90, true);
  assert.match(prompt, /between 30 and 90 seconds/);
});

test("equal min and max bounds ask for an exact duration instead of an impossible range", () => {
  const prompt = buildSystemPrompt(60, 60, true);
  assert.match(prompt, /exactly 60 seconds/);
  assert.doesNotMatch(prompt, /between 60 and 60 seconds/);
});

test("the hour is preserved when converting a timestamp tag, not discarded", () => {
  const prompt = buildSystemPrompt(15, 120, true);
  assert.doesNotMatch(prompt, /ignore the "hh"/);
  assert.match(prompt, /01:02:03:00\] is 1:02:03/);
  // The old wording's own example proved the bug: it said [00:32:04:22] is
  // 32:04 while telling the model to discard "hh" - true only because that
  // example's hour happens to be zero. An hour of "01" or more must not
  // collapse to the same mm:ss shape.
  assert.doesNotMatch(prompt, /is 02:03/);
});
