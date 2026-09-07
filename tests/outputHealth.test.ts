import assert from "node:assert/strict";
import test from "node:test";

import { describeOutputIssues } from "../lib/outputHealth.ts";

function clipOption(n: number): string {
  return `Option ${n}
Timestamps: 00:0${n} - 00:1${n}
Duration: 30 seconds
Title: Synthetic clip ${n}
Transcript: Synthetic verbatim line ${n}
Description: Synthetic context ${n}
Why it works: Synthetic reason ${n}`;
}

const COMPLETE = `### Titles
Synthetic title option.

### Description
Synthetic description body.

### Chapters
00:00 Start

### Clips
${[1, 2, 3].map(clipOption).join("\n\n")}`;

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

// AUDIT.md F4: a heading with nothing under it, or a Clips section that never
// finishes, used to pass as healthy because the check only looked at heading
// names.

test("a heading present with an empty body counts as missing, not present", () => {
  const emptyHeadings = "### Titles\n\n### Description\n\n### Chapters\n\n### Clips";
  const issues = describeOutputIssues(emptyHeadings);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "missing-sections");
  assert.match(
    issues[0]?.message ?? "",
    /Titles, Description, Chapters and Clips are missing/,
  );
});

test("fewer than three clips reports an incomplete response", () => {
  const oneClip = COMPLETE.replace(`\n\n${clipOption(2)}\n\n${clipOption(3)}`, "");
  const issues = describeOutputIssues(oneClip);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "incomplete-clips");
  assert.match(issues[0]?.message ?? "", /Only 1 of 3 expected clips/);
});

test("a clip cut off mid-field reports an incomplete response", () => {
  const truncatedLastClip = COMPLETE.replace(
    "Why it works: Synthetic reason 3",
    "",
  );
  const issues = describeOutputIssues(truncatedLastClip);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "incomplete-clips");
  assert.match(issues[0]?.message ?? "", /Option 3 is missing a field/);
});

test("an untimed transcript's 'Not available' timestamps still count as present", () => {
  const untimedClip = (n: number) => `Option ${n}
Timestamps: Not available (source transcript has no timestamps)
Duration: Not available (source transcript has no timestamps)
Title: Synthetic clip ${n}
Transcript: Synthetic verbatim line ${n}
Description: Synthetic context ${n}
Why it works: Synthetic reason ${n}`;

  const untimed = `### Titles
Synthetic title option.

### Description
Synthetic description body.

### Chapters
Start

### Clips
${[1, 2, 3].map(untimedClip).join("\n\n")}`;

  assert.deepEqual(describeOutputIssues(untimed), []);
});
