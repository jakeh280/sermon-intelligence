import assert from "node:assert/strict";
import test from "node:test";

import { describeOutputIssues } from "../lib/outputHealth.ts";

const COMPLETE = `### Titles
Synthetic title option.

### Description
Synthetic description body.

### Chapters
00:00 Start

### Clips
Option 1
Title: Synthetic clip`;

test("a complete response reports no issues", () => {
  assert.deepEqual(describeOutputIssues(COMPLETE), []);
});

test("an empty or whitespace only response is reported as empty", () => {
  for (const output of ["", "   ", "\n\n \r\n"]) {
    const issues = describeOutputIssues(output);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.code, "empty");
  }
});

test("a response with no headings is reported as unstructured", () => {
  const issues = describeOutputIssues(
    "Synthetic prose with no section headings at all.",
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "unstructured");
});

test("a truncated response names the sections that never arrived", () => {
  const truncated = `### Titles
Synthetic title option.

### Description
Synthetic description body.`;
  const issues = describeOutputIssues(truncated);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "missing-sections");
  assert.match(issues[0]?.message ?? "", /Chapters and Clips are missing/);
});

test("a single missing section reads as singular", () => {
  const issues = describeOutputIssues(
    COMPLETE.slice(0, COMPLETE.indexOf("### Clips")),
  );
  assert.equal(issues[0]?.code, "missing-sections");
  assert.match(issues[0]?.message ?? "", /Clips is missing/);
});

test("a leading preamble does not count as a section", () => {
  const issues = describeOutputIssues(`Here is the plan.\n\n${COMPLETE}`);
  assert.deepEqual(issues, []);
});

test("section detection matches the headings the cards render", () => {
  const issues = describeOutputIssues(
    COMPLETE.replace("### Clips", "### Clips for Social").replace(
      "### Titles",
      "### Titles (3 options)",
    ),
  );
  assert.deepEqual(issues, []);
});
