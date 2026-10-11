# Code organization, patterns, debugging, common tasks

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
│   ├── boundedBody.ts        # Reads a request body without exceeding a byte cap
│   ├── clipRange.ts          # Clip range constants, snapping, and labels
│   ├── demoContent.ts        # Frozen, attributed output for the "View Demo" button
│   ├── history.ts            # Safe browser history decoding
│   ├── historyStorage.ts     # localStorage access that cannot throw
│   ├── outputHealth.ts       # Empty, unstructured, and truncated response checks
│   ├── outputParsing.ts      # Pure Markdown and clip output parsing
│   ├── proxyRateLimit.ts     # Pure rate limit decision logic, called from proxy.ts
│   ├── requestErrors.ts      # Stall timeout and user facing failure messages
│   ├── rateLimitConfig.ts    # rate limit window and request count, read by proxy.ts
│   ├── site.ts               # canonical site metadata and structured data
│   ├── systemPrompt.ts       # buildSystemPrompt(min, max) function
│   ├── transcript.ts         # Premiere, SRT, and WebVTT normalization
│   └── transcriptInput.ts    # Accepted formats, limits, encoding
├── tests/
│   ├── analysisLogic.test.ts # Parser, range, and history regression tests
│   ├── boundedBody.test.ts           # Request body size cap
│   ├── browserResilience.test.ts     # Storage, upload, and request failures
│   ├── demoContent.test.ts           # Demo output stays in sync with the system prompt
│   ├── outputHealth.test.ts          # Malformed response detection
│   ├── outputParsingResilience.test.ts # Model formatting drift
│   ├── proxyRateLimit.test.ts         # Rate limit window, reset message, per-IP keying
│   ├── systemPrompt.test.ts          # Prompt construction and timestamp rules
│   └── transcriptFormats.test.ts     # Timestamp and caption formats
├── public/                   # Static assets: robots.txt, llms.txt, SVGs, favicon
├── proxy.ts                  # Next.js middleware (Next 16 convention): per-IP rate limiting
├── tsconfig.json
├── next.config.ts            # Security response headers
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

