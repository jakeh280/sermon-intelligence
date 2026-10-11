# System prompt and AI output parsing

## System Prompt

**File:** `lib/systemPrompt.ts` — `buildSystemPrompt(clipMinSec, clipMaxSec, hasTimestamps)` function

Key behaviors:
- Generates 3 YouTube title options: Human Tension, Theological Point, Biblical Context (5–8 words each)
- Generates YouTube description (150–200 words)
- Generates YouTube chapters (capped at 6–9 regardless of sermon length, format: `mm:ss Chapter Name`, or `h:mm:ss Chapter Name` past the first hour)
- Generates 3 social clips with: Timestamps, Duration, Title, Transcript, Description, Why it works
- Bans filler phrases: "we explore", "join us", "we discover"
- Writes in 1st-person plural ("we", "us") as the church
- NO em-dashes or unnecessary dashes
- Double line breaks between sections
- Clip duration must fall between `clipMinSec` and `clipMaxSec`, inclusive (equal min/max asks for that exact duration)

`hasTimestamps` is `hasTimestampTags(text)` from `lib/transcript.ts`, computed
in `app/api/chat/route.ts` from the normalized transcript. When false (no
`[hh:mm:ss:ff]` tag anywhere, e.g. a transcription export with no per-segment
timing), the prompt switches to rules that forbid inventing a time: chapters
lose their `mm:ss` prefix and clips report `Timestamps`/`Duration` as "Not
available" instead of a fabricated value. `app/page.tsx` also checks this
client side and shows a warning before the user generates, so they find out
before spending a request rather than after.

---

## Architecture Patterns

### Input Processing

Three input modes:
1. **File Upload** (`.txt`, `.srt`, or `.vtt` files only)
2. **Direct Paste** (textarea for transcript text)
3. **History** (localStorage-backed recent generations)

Accepted extensions, size and length limits, and the byte order mark aware
decoder all live in `lib/transcriptInput.ts`. `MAX_TRANSCRIPT_CHARACTERS` is
imported by the API route, so the limit is defined once.

```typescript
export const ACCEPTED_EXTENSIONS = [".txt", ".srt", ".vtt"] as const;
```

### Transcript Normalization

`lib/transcript.ts` rewrites timestamped exports into the `[hh:mm:ss:ff]` tags
`buildSystemPrompt()` documents, before the text reaches the model.

- **Premiere ranges** (`hh:mm:ss:ff - hh:mm:ss:ff`), including drop frame
  semicolons and millisecond variants. `Unknown` speaker labels are dropped;
  named speakers are kept.
- **DaVinci Resolve ranges** are the same shape wrapped in one pair of square
  brackets (`[hh:mm:ss:ff - hh:mm:ss:ff]`), with the sentence starting on the
  very next line and no speaker line at all. The bracket pair is stripped
  before matching, so it reuses the Premiere range path.
- **SRT and WebVTT cues** are converted to the same tags, dropping cue indices
  and metadata blocks. Cue text is never rewritten, so inline markup survives
  and the prompt's verbatim clip rule still holds.
- Caption conversion is **all or nothing**: anything unaccounted for (a WebVTT
  cue identifier, missing blank lines, stray prose) passes the file through
  untouched rather than half converting it.
- Milliseconds map to `:00` frames rather than guessing a frame rate, which is
  safe only because the prompt tells the model to ignore the frames component.
- Normalizing is idempotent. Both `app/page.tsx` and the API route call it.

### Clip Range Slider

- Floor: 15 seconds (`CLIP_MIN_ALLOWED`)
- Ceiling: 600 seconds (`CLIP_MAX_ALLOWED`)
- Step: 5 seconds (snapped to nearest 5)
- Dual-handle range input with visual progress bar

```typescript
function snapClipSec(n: number): number {
  const r = Math.round(n / CLIP_STEP) * CLIP_STEP;
  return Math.min(CLIP_MAX_ALLOWED, Math.max(CLIP_MIN_ALLOWED, r));
}
```

### Output Parsing

Pure parsing lives in `lib/outputParsing.ts`. Keep model response interpretation
there so format changes can be tested without rendering the page.

Parsing is deliberately tolerant of formatting the model drifts into: option
headers behind bold, headings or bullets; field labels with the colon inside the
bold; treating `### ` and `## ` as the *same* heading level (see below); and
heading-shaped lines inside a fenced code block, which are masked before
splitting so a quoted excerpt can't be mistaken for a section boundary. An
option header must still be the entire line, so quoted text cannot split a
clip, and a clip field label only starts a new field when it's the next
expected one (or that field's own exact label, not a looser alias) - so a
stray "Why:"/"Time:"/"Title:" inside a verbatim quote can't truncate it.

Sections split on `/^#{2,3}\s+/m` - "### " and "## " are matched by the same
pass, not tried as two separate strict/relaxed candidates. An earlier version
did try them separately and picked whichever recovered more of the four
canonical sections, which broke down when the model used *different* levels
for sibling sections (e.g. "### Titles" alongside "## Chapters"): both passes
recovered 2 of 4 and tied, and the tie-break kept only one pair while the
other's content was swallowed into the section before it. Matching both
levels in one pass recovers all four regardless of which level the model used
per section. "####" is deliberately excluded, since it's plausible as a
subheading inside a well formed section.

The model sometimes over-applies "every section starts with `### `" and gives
each individual chapter its own heading instead of listing them under one
`### Chapters` heading, which would otherwise shred into an empty "Chapters"
card plus one near-empty card per chapter. Any `### ` (or `## `, through the
fallback) heading that isn't one of the four the prompt defines (Titles,
Description, Chapters, Clips) is folded back into the section before it as a
list line instead of kept as its own section.

`lib/outputHealth.ts` inspects a **completed** response and reports empty,
unstructured, missing-section, or incomplete-clips results (a Clips section
whose heading and body arrived but didn't resolve to 3 fully-fielded clips).
Never run it mid stream: a partial stream is legitimately missing sections.

AI response is streamed as Markdown and parsed into sections:
- Splits on `### ` headers via `parseBentoSections()`
- Each section becomes a Bento card
- **Titles section:** Rendered as 3-column flex layout
- **Clips section:** Parsed with `parseClipOptions()` into structured `ParsedClip` objects
- **Other sections:** Standard Markdown rendering with custom components

```typescript
function parseClipFieldLines(block: string): Partial<Record<ClipFieldKey, string>>
function splitClipOptionBlocks(body: string): { preamble: string; blocks: string[] }
function parseClipOptions(body: string): { preamble: string; clips: ParsedClip[] }
```

### Bento Cards

The result cards still live in `app/page.tsx`. Pure parsing, clip range rules,
and history decoding no longer belong in that component. Card types:
1. **BentoCard** — Standard Markdown content with copy button
2. **TitlesBentoCard** — Renders 3 title options as horizontal cards
3. **ClipsBentoCard** — Parses and displays 3 clip options in grid layout

All cards:
- Stream live as text arrives
- Include copy-to-clipboard
- Animate in with `fade-in slide-in-from-bottom`
- Support full Markdown formatting

The full-output copy action appends a single attribution line linking to
`https://sermonintelligence.com/`. Individual section copies remain unmodified.
Completed results also include an "Analyze Another Sermon" action that clears
the current inputs and output, then returns the user to the top of the page.

---

