<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Sermon Intelligence — Agent Development Guide

## Project Overview

Sermon Intelligence is a free web app for church media directors that analyzes sermon transcripts and generates YouTube metadata (titles, descriptions, chapter markers) and social media clip suggestions.

- **Framework:** Next.js 16.2.9 + React 19 + TypeScript
- **Hosting:** Vercel (free hobby tier)
- **Styling:** Tailwind CSS v4
- **AI SDK:** Vercel AI SDK (`ai` ^6.x) with `@ai-sdk/google` provider
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

**File:** `lib/systemPrompt.ts` — `buildSystemPrompt(clipMinSec, clipMaxSec)` function

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

---

## Architecture Patterns

### Input Processing

Three input modes:
1. **File Upload** (`.txt` or `.srt` files only)
2. **Direct Paste** (textarea for transcript text)
3. **History** (localStorage-backed recent generations)

```javascript
const ACCEPTED = new Set([".txt", ".srt"]);
```

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

All UI is in `app/page.tsx` (no separate `components/` folder). Card types:
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

**File:** `proxy.ts` (root level — this is NOT a Next.js `middleware.ts`)

```typescript
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 5;           // 5 requests per IP per hour
```

Returns HTTP 429 with reset time if exceeded. Configured with `config.matcher = "/api/chat"`.

---

## History & Storage

Uses browser `localStorage`:
- Key: `sermon_history`
- Stores up to 10 most recent generations
- Each item: id, timestamp, label, full output, clip min/max settings
- Accessible via "History" button in header

Public share links, server-side output storage, and output feedback are
intentionally deferred. Do not add them without first deciding retention,
deletion, privacy disclosure, and abuse-protection requirements. A public demo
is also pending a real, attributed example transcript and output from Jake.

---

## Deployment & Environment

- **Platform:** Vercel free hobby tier, Node.js 18+ runtime
- **`maxDuration = 60`** seconds for streaming responses
- **Env var:** `GOOGLE_GENERATIVE_AI_API_KEY`
- **Analytics:** Vercel Analytics (`@vercel/analytics`, free tier), wired via `<Analytics />` in `app/layout.tsx`. Google Analytics and Microsoft Clarity were both removed (July 2026).

```bash
npm run dev      # Local development (port 3000)
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
│   ├── page.tsx              # Main UI (1600+ lines, all client-side logic + bento cards)
│   ├── layout.tsx            # RootLayout, metadata
│   ├── globals.css           # Tailwind imports, CSS variables
│   └── api/
│       └── chat/
│           └── route.ts      # Server endpoint, Gemini API streaming
├── lib/
│   └── systemPrompt.ts       # buildSystemPrompt(min, max) function
├── public/                   # Static assets (SVGs, favicon)
├── proxy.ts                  # Rate limiting logic (not a Next.js middleware)
├── tsconfig.json
├── next.config.ts            # Minimal/empty config
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
1. Update `ACCEPTED` file extensions
2. Add parsing logic to `handleFiles()`
3. Update error messages

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

**Last Updated:** 2026-06-23
**Status:** Active maintenance, occasional feature additions
