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
