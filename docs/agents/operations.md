# Limitations, rate limiting, storage, demo, deployment

## Known Limitations & Workarounds

### YouTube Transcript Fetching (REMOVED)

Cannot fetch live YouTube transcripts from Vercel (requests are blocked). Feature permanently removed.

**Workaround:** Users must supply a transcript manually or via a tool like [Transcrisper](https://transcrisper.com/).

---

## Rate Limiting

**File:** `proxy.ts` at the root. This is Next.js middleware, not a helper the
API route calls: as of Next 16, a root `proxy.ts` exporting a `proxy` function
is auto-wired in and runs before every matching request (`next build` lists it
as `ƒ Proxy (Middleware)`). It predates that convention - it was originally a
plain module written before Next 16 introduced the `proxy.ts` name, and the
Next 16 upgrade silently turned it into real middleware.

Until 2026-09-08 this ran alongside a second, independent check in
`app/api/chat/route.ts` (`lib/rateLimit.ts`), added earlier and never removed
once proxy.ts started actually running. The two used different algorithms -
proxy.ts a fixed window (count resets to zero on the hour), the route-level
check a sliding window (a rolling list of hit timestamps) - and only the
sliding window closes a real gap a fixed window has: without it, a burst of
`MAX_REQUESTS` right before the reset plus another right after can let
~2x the limit through in a short span straddling the boundary. Consolidating
to one limiter meant that one had to inherit the sliding-window algorithm,
not the fixed-window one, or removing the duplicate would have quietly
doubled the worst-case burst instead of just removing dead weight.

```typescript
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 20;          // 20 requests per IP in any trailing hour
```

Values live in `lib/rateLimitConfig.ts`. The actual sliding-window decision is
a pure function in `lib/proxyRateLimit.ts` (`checkAndRecord`), kept separate
from proxy.ts's NextRequest/NextResponse glue so it's unit testable without
Next's runtime - see `tests/proxyRateLimit.test.ts`. Returns HTTP 429 with a
"try again in N minutes" reset time if exceeded (computed from when the
oldest hit in the window ages out, not a fixed clock boundary). Configured
with `config.matcher = "/api/chat"`.

Raised from 5 to 20 on 2026-07-19: Gemini spend was $0.13 across 90 days against a
$5 monthly cap, so the old limit throttled real users to guard a cost that never
materialized.

**Which address is limited (2026-09-30):** the custom domain is proxied through
Cloudflare in front of Vercel, and Vercel overwrites `x-forwarded-for` with the
connecting address (its documented behavior; not probed live), a Cloudflare edge
shared by every visitor routed through that location. That most likely put a whole
region in one 20-per-hour bucket. The fix is correct either way: if Vercel ever
appends instead, the first entry is already the visitor and nothing changes.
`getClientIp` now uses `cf-connecting-ip` (the visitor's own address), but only when
the connecting address is inside Cloudflare's published ranges
(`lib/cloudflareIps.ts`), because anyone calling the Vercel origin directly can send
that header. Tests cover both the proxied case and a forged header.

**Also on the route (same date):** non-JSON requests get a 415 (a cross-site
`text/plain` POST skips the CORS preflight), provider error messages are logged but no
longer returned to visitors, and `maxOutputTokens: 16000` caps a runaway generation.

**Persistent admission (2026-10-21):** The in-process proxy remains a cheap first filter, but the API route also obtains admission from `lib/sharedRateLimit.ts` after validating input and before contacting Gemini. A Cloudflare SQLite Durable Object serializes all decisions and persists them across application cold starts. Limits are 20 per address in a trailing hour, 50 sitewide per UTC day, and 500 sitewide per UTC calendar month. Preview deployments use a separate object, so testing cannot consume production's allowance. These are request ceilings, not a verified currency spending cap. A refused request returns 429 with Retry-After; counter failure returns 503 and makes no provider call.

The limiter receives only an HMAC digest of the address, never the raw address, transcript, or generated output. Address digests expire after an hour; only active daily and monthly aggregate counts remain. Worker request logging is disabled. The Worker accepts only authenticated server POSTs; the shared secret is never exposed to browsers. Production and preview require the shared service configuration. Local development may omit it and retains the in-process proxy.

Source lives in `workers/abuse-limiter/`. Deploy with existing Wrangler tooling, using its `wrangler.jsonc`. The SQLite-backed Durable Object is supported on Workers Free; free limits fail closed rather than generating overage charges. No paid plan was enabled. Server environment variables are `ABUSE_LIMITER_URL` (the matching `/consume/production` or `/consume/preview` HTTPS URL) and secret `ABUSE_LIMITER_SECRET`. The Worker secret is `LIMITER_SECRET`. Configure these before deploying the application. Tests: `npm test` plus `node --test workers/abuse-limiter/worker.test.mjs`.

Provider-side quota and any historical $5 budget setting have not been independently verified. Budget alerts are not proof that billing stops at a dollar amount. The existing model and input/output caps remain in place.

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

