<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Sermon Intelligence — Agent Development Guide

## Project Overview

Sermon Intelligence is a free web app for church media directors that analyzes sermon transcripts and generates YouTube metadata (titles, descriptions, chapter markers) and social media clip suggestions.

- **Framework:** Next.js 16.3.2 + React 19 + TypeScript
- **Hosting:** Vercel (free hobby tier)
- **Styling:** Tailwind CSS v4
- **AI SDK:** Vercel AI SDK (`ai` ^7.x) with `@ai-sdk/google` provider
- **AI Models:** Gemini 3.5 Flash Lite via Google Generative AI API
- **Deployment:** GitHub + Vercel auto-deploy

---

## Critical Model Selection Rules

### Primary Model: `gemini-3.5-flash-lite` (REQUIRED)

Raised from `gemini-2.5-flash-lite` on 2026-07-24 — 2.5 remains stable but 3.5 Flash-Lite (released 2026-07-21) is the current cheapest/fastest tier for this workload.

**DO NOT use `gemini-2.0-flash`** — it causes silent failures on this project:
- App loads normally
- Request appears to execute
- App quietly returns to homepage with no error message
- No console errors or warnings
- Extremely difficult to debug

```typescript
// app/api/chat/route.ts
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const model = google("gemini-3.5-flash-lite"); // CORRECT
// const model = google("gemini-2.0-flash");    // DO NOT USE
```

### Under consideration: `gpt-5.6-luna` (not adopted, exploratory only)

Jake is evaluating OpenAI's `gpt-5.6-luna` as a possible alternative (2026-08-03).
Launched 2026-07-09 at $1/$6 per 1M input/output tokens; cut 80% on 2026-07-30 to
$0.20/$1.20 per 1M tokens. Still pricier per-token than `gemini-3.5-flash-lite`
(~$0.10/$0.40 per 1M), but at this app's traffic (rate-limited to 5 req/IP/hour)
the dollar difference is cents/month either way — cost is not the deciding factor.

Switching would require adding an `@ai-sdk/openai` provider and reworking the
model init in `app/api/chat/route.ts`. Before switching, run a real transcript
through both models and compare adherence to the system prompt's strict
formatting rules (banned filler phrases, exact clip duration bounds, chapter
formatting) — pricing pages don't tell you that, and this project has already
been burned once by a model that silently failed (see `gemini-2.0-flash` above).
No decision made yet; revisit if/when explored further.

---

## System Prompt

**File:** `lib/systemPrompt.ts` — `buildSystemPrompt(clipMinSec, clipMaxSec, hasTimestamps)` function

Key behaviors:
- Generates 3 YouTube title options: Human Tension, Theological Point, Biblical Context (5–8 words each)
- Generates YouTube description (150–200 words)
- Generates YouTube chapters (5–8 for short sermons, 8–12 for 60m+, format: `mm:ss Chapter Name`)
- Generates 3 social clips with: Timestamps, Duration, Title, Transcript, Description, Why it works
- Bans filler phrases: "we explore", "join us", "we discover"
- Writes in 1st-person plural ("we", "us") as the church
- NO em-dashes or unnecessary dashes
- Double line breaks between sections
- Clip duration must fall strictly between `clipMinSec` and `clipMaxSec`

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
bold; and a fallback to `## ` headings when a response contains no `### ` at
all. An option header must still be the entire line, so quoted text cannot split
a clip.

The model sometimes over-applies "every section starts with `### `" and gives
each individual chapter its own heading instead of listing them under one
`### Chapters` heading, which would otherwise shred into an empty "Chapters"
card plus one near-empty card per chapter. Any `### ` (or `## `, through the
fallback) heading that isn't one of the four the prompt defines (Titles,
Description, Chapters, Clips) is folded back into the section before it as a
list line instead of kept as its own section.

`lib/outputHealth.ts` inspects a **completed** response and reports empty,
unstructured, or missing-section results. Never run it mid stream: a partial
stream is legitimately missing sections.

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

## Known Limitations & Workarounds

### YouTube Transcript Fetching (REMOVED)

Cannot fetch live YouTube transcripts from Vercel (requests are blocked). Feature permanently removed.

**Workaround:** Users must supply a transcript manually or via a tool like [Transcrisper](https://transcrisper.com/).

---

## Rate Limiting

**Files:** `proxy.ts` at the root, plus `lib/rateLimit.ts` called directly by the API route. The proxy is not a Next.js `middleware.ts`.

```typescript
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 20;          // 20 requests per IP per hour
```

Returns HTTP 429 with reset time if exceeded. Configured with `config.matcher = "/api/chat"`.

Raised from 5 to 20 on 2026-07-19: Gemini spend was $0.13 across 90 days against a
$5 monthly cap, so the old limit throttled real users to guard a cost that never
materialized. Keep this figure in sync in both limiter files.

**Known limitation:** `ipStore` is an in-process `Map`, and Vercel serverless
instances neither share memory nor persist across cold starts. So the limit is
best effort: counts reset on a cold start and are tracked per instance, not
globally. Fine at current spend. If abuse ever becomes real, this needs a shared
store (Upstash Redis or Vercel KV), not a bigger number.

---

## History & Storage

Uses browser `localStorage`:
- Key: `sermon_history`
- Stores up to 10 most recent generations
- Each item: id, timestamp, label, full output, clip min/max settings
- Accessible via "History" button in header

Public share links, server-side output storage, and output feedback are
intentionally deferred. Do not add them without first deciding retention,
deletion, privacy disclosure, and abuse-protection requirements.

## Public Demo

**File:** `lib/demoContent.ts`

The "View Demo" button (header, next to History) loads a frozen, real,
attributed example: `DEMO_OUTPUT` is a genuine past `gemini-3.5-flash-lite`
response to a real sermon transcript, hand checked against the STRICT
VERBATIM RULE and METADATA ANCHOR RULE in `lib/systemPrompt.ts`, then frozen
as a static asset. It is not regenerated per view: no request is sent, no
rate limit slot is spent, and the content can't drift between visits.

Used with permission (Jake works at the church). `DEMO_ATTRIBUTION` names the
speaker and church and links to the church's site; that attribution renders
in a clearly labeled banner (`app/page.tsx`, `isDemo` state) whenever the demo
is showing, and "Try Your Own Transcript" resets back to the normal input
flow. `tests/demoContent.test.ts` guards the frozen asset against a careless
hand edit: it must still parse into exactly the four canonical sections and
avoid the banned filler phrases.

If you add more demo entries or swap this one out, hold the replacement to
the same bar: a real transcript, permission to feature it, and a hand
verified output, not a live generation.

---

## Deployment & Environment

- **Platform:** Vercel free hobby tier, current Vercel Node.js runtime
- **`maxDuration = 60`** seconds for streaming responses
- **Env var:** `GOOGLE_GENERATIVE_AI_API_KEY`
- **Analytics:** Vercel Analytics (`@vercel/analytics`, free tier), wired via `<Analytics />` in `app/layout.tsx`, plus Cloudflare Web Analytics injected by the Cloudflare zone. Both are disclosed in the Privacy panel. Google Analytics and Microsoft Clarity were both removed (July 2026).
- **Gemini data terms:** The API project has active billing. The Privacy panel links to the Gemini API terms and reflects the paid service rules rather than the unpaid service model improvement language.

```bash
npm run dev      # Local development (port 3000)
npm test         # Pure analysis and browser history logic
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

TypeScript: ES2017 target, ESNext modules, strict mode, `@/*` path alias to project root.

---

## Code Organization

```
sermon-intelligence/
├── app/
│   ├── page.tsx              # Main UI, orchestration, and bento cards
│   ├── layout.tsx            # RootLayout, metadata
│   ├── globals.css           # Tailwind imports, CSS variables
│   ├── error.tsx             # Friendly route error recovery
│   ├── opengraph-image.tsx   # Generated social sharing image
│   └── api/
│       └── chat/
│           └── route.ts      # Server endpoint, Gemini API streaming
├── lib/
│   ├── clipRange.ts          # Clip range constants, snapping, and labels
│   ├── history.ts            # Safe browser history decoding
│   ├── historyStorage.ts     # localStorage access that cannot throw
│   ├── outputHealth.ts       # Empty, unstructured, and truncated response checks
│   ├── outputParsing.ts      # Pure Markdown and clip output parsing
│   ├── requestErrors.ts      # Stall timeout and user facing failure messages
│   ├── rateLimit.ts          # route level burst limiter and client key
│   ├── rateLimitConfig.ts    # shared rate limit window and request count
│   ├── site.ts               # canonical site metadata and structured data
│   ├── systemPrompt.ts       # buildSystemPrompt(min, max) function
│   ├── transcript.ts         # Premiere, SRT, and WebVTT normalization
│   └── transcriptInput.ts    # Accepted formats, limits, encoding
├── tests/
│   ├── analysisLogic.test.ts # Parser, range, and history regression tests
│   ├── browserResilience.test.ts     # Storage, upload, and request failures
│   ├── outputHealth.test.ts          # Malformed response detection
│   ├── outputParsingResilience.test.ts # Model formatting drift
│   └── transcriptFormats.test.ts     # Timestamp and caption formats
├── public/                   # Static assets (SVGs, favicon)
├── proxy.ts                  # Rate limiting logic (not a Next.js middleware)
├── tsconfig.json
├── next.config.ts            # Security response headers
├── tailwind.config.js
├── postcss.config.mjs
├── package.json
├── CLAUDE.md                 # Points to AGENTS.md
└── AGENTS.md                 # This file
```

---

## Coding Patterns

### State Management
- React hooks only (no external state library)
- `useCallback` for function stability
- `useMemo` for expensive parsing (output sections, clip options)
- `useRef` for file input and slider refs

### TypeScript
- All components typed; no `any`
- Use `type` for discriminated unions (e.g., `"upload" | "paste"`)
- Props interfaces defined inline for small components

### Markdown Rendering
React-Markdown with custom component overrides:
- Links open in new tab with underline
- Headings reduced to `<h4>` for hierarchy
- Code blocks and blockquotes styled with Tailwind
- Tables with borders and hover effects

---

## Debugging Tips

### Silent Failure (Model Issue)
If app loads then returns to homepage with no errors:
1. Check `app/api/chat/route.ts` model name — must be `gemini-3.5-flash-lite`
2. Verify `process.env.GOOGLE_GENERATIVE_AI_API_KEY` exists in Vercel settings
3. Test the endpoint directly with curl/Postman

### Streaming Not Working
- Check DevTools Network tab for `/api/chat` request
- Verify response `Content-Type` is `text/event-stream`
- Ensure `result.toTextStreamResponse()` is used (not `.text()`)

### Clip Parsing Broken
- Verify AI output includes exact field labels (case-insensitive): `Timestamps`, `Duration`, `Title`, `Transcript`, `Description`, `Why it works`
- Check system prompt hasn't changed the output format
- Test with `parseClipOptions()` in browser console

---

## Quick Reference: Common Tasks

### Add a New AI Feature
1. Update `lib/systemPrompt.ts`
2. Modify output parsing in `app/page.tsx` if format changes
3. Add a new card type if special rendering is needed

### Update System Prompt
1. Edit `lib/systemPrompt.ts`
2. Ensure server still uses `gemini-3.5-flash-lite`
3. Test with a real transcript locally, then deploy to Vercel

### Add a New Input Format
1. Update `ACCEPTED_EXTENSIONS` in `lib/transcriptInput.ts`
2. Update the `accept` attribute and the supported formats hint in `app/page.tsx`
3. Add normalization to `lib/transcript.ts`, keeping it all or nothing
4. Cover it in `tests/transcriptFormats.test.ts` with synthetic fixtures only

### Modify Clip Validation
1. Change `CLIP_FLOOR_SEC`, `CLIP_CEIL_SEC`, `CLIP_STEP`
2. Update `snapClipSec()`
3. Update slider UI range attributes
4. Update system prompt clip duration bounds

---

## Contact & Support

- **Creator:** Jake (Overflow Creative)
- **Feedback:** [Tally Form](https://tally.so/r/wkJPlj)
- **Instagram:** [@jake.crtv](https://www.instagram.com/jake.crtv/)
- **YouTube:** [@overflow.creative](https://www.youtube.com/@overflow.creative)

---

**Last Updated:** 2026-08-30
**Status:** Active maintenance, occasional feature additions
