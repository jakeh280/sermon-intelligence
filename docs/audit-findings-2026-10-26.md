# Audit findings, 2026-10-26

A fresh read of the whole app after the persistent limiter landed (8e72b91):
the API route, `proxy.ts`, the Cloudflare limiter Worker, the `lib/` helpers and
`app/page.tsx`. Format follows overflow-console's `audit-findings-2026-10-20.md`.
Status moves to `fixed` as changes land.

Severity: **high** is data loss, a security hole, or a paid call nobody asked
for; **medium** is a real cost or a wrong-but-recoverable behavior a visitor will
hit; **low** is cleanup, polish, or a rare edge.

Nothing high turned up. The route's input checks, the CORS-preflight 415, the
bounded body read, the `cf-connecting-ip` trust rule, the HMAC'd limiter call and
the `img: () => null` markdown override all hold up. `javascript:` links in model
output are blanked by react-markdown's default URL filter (checked).

Fixes in `lib/` and the Worker-drift check are covered by `npm test`. Fixes that
live only in `app/page.tsx` (A3 to A11) have no unit harness (no DOM in
`node --test`), so they were checked with lint, the typecheck and the build only.
They have not been looked at in a browser; do a pass through View Demo and
History before deploying. Generate was never clicked, so no Gemini call was made.

### A1. A long caption file is refused before normalization shrinks it. medium. fixed, see git log

`handleFiles` and `handleGenerate` checked the raw text against the 150,000
character cap. The route checks the normalized text. Normalizing an SRT, VTT or
Premiere export drops the cue numbers and turns each `00:01:02,000 --> 00:01:05,000`
line into a short `[00:01:02:00]` tag, which removes a large share of the file.
So a long sermon exported as SRT, the format the page tells people to use, could
be refused in the browser with "Transcript is too long" when the server would
have accepted it.

Done: `describeTranscriptProblem` measures `normalizeTranscript(text)` against
the cap. The browser now refuses exactly what the route would refuse. Tested with
an SRT that is over the cap raw and under it normalized.

### A2. The sitewide limit says "Try again in 1440 minutes". medium. fixed, see git log

The Worker answers a daily or monthly sitewide refusal with a Retry-After of up
to a day or a month. The route turned every Retry-After into minutes, so a
visitor could read "Try again in 1440 minutes", or a five-figure number near the
start of a month.

Done: `formatRetryAfter` in `lib/rateLimitMessage.ts` says minutes under two
hours, then hours, then days. The route and `proxy.ts` both use it. Tested at
59 seconds, an hour, a day, and a month.

The message still reads as a personal limit when the sitewide budget is what ran
out; see A13.

### A3. The rate-limit notice spins like something is loading. low. fixed, see git log

The amber limit notice drew `Loader2` with `animate-spin`, so a refusal looked
like a request in progress.

Done: a static clock icon.

### A4. Every rendered markdown element carried `node="[object Object]"`. low. fixed, see git log

react-markdown passes its syntax tree node as a `node` prop. Each component in
`markdownComponents` (and the Titles overrides) spread all props onto the DOM
element, so every paragraph, list item and link in the output had a junk
`node="[object Object]"` attribute. Checked by rendering a sample with the
installed react-markdown. In the `a` override the spread also came after
`target` and `rel`, so anything in the props could have replaced them.

Done: `node` is dropped before the spread, and the link's `target`/`rel` come
last.

### A5. Error messages are not announced to screen readers. low. fixed, see git log

The red error block under Generate had no live region, so a screen reader user
pressing Generate with nothing loaded heard nothing.

Done: `role="alert"` on the error block.

### A6. History's delete button is invisible on phones. low. fixed, see git log

The trash button was `opacity-0` until hover or focus. Touch screens have no
hover, so the button was there but could not be seen.

Done: the button is hidden until hover only on devices that can hover.

### A7. Clear All History has no confirmation. medium. fixed, see git log

One click on "Clear All History" deleted every saved result, with no undo. The
results are not stored anywhere else.

Done: the first click turns the button into "Click again to clear all 10" (or "it"); a
second click clears it. The confirm state resets when the dialog closes.

### A8. View Demo and History do nothing while a result streams. low. fixed, see git log

Both handlers return early during a generation (correctly, so the stream can't
overwrite what they load), but the buttons stayed live, so a click did nothing
and the History dialog stayed open.

Done: View Demo is disabled during a generation, and History's entries are
disabled with a line saying a result is still being generated.

### A9. "Handles any length transcript" contradicts the 150,000 character cap. low. fixed, see git log

The Cloud AI card said "Handles any length transcript", and the route refuses
anything over 150,000 characters.

Done: "Handles transcripts up to about 2 hours", the same estimate
`TOO_LONG_MESSAGE` uses.

### A10. The Clips card has no Copy button. low. fixed, see git log

Titles, Description and Chapters each have a Copy button. Clips, the card people
most likely want to paste into an editor's notes, did not.

Done: the Clips card has the same Copy button, copying the section's markdown.

### A11. Small cleanups in `app/page.tsx`. low. fixed, see git log

- The FileReader `onerror` set the same error message twice.
- An empty `<span className="text-white font-semibold"></span>` sat at the start
  of the header note.
- The transcript drop zone used a camera icon. It is now a file upload icon. The
  footer's Instagram link keeps the camera.
- The comment on `aiLimitError` said `proxy.ts` is the only limiter in front of
  the route. The route's own persistent admission check also returns 429.
- Section Copy buttons failed silently. They now say "Copy failed" for two
  seconds.

### A12. `proxy.ts` 429 had no Retry-After and an empty forwarded address made its own bucket. low. fixed, see git log

The in-process limiter's 429 had no `Retry-After` or `Cache-Control: no-store`,
unlike the route's. Separately, `getClientIp` used `??` on the first
`x-forwarded-for` entry, so an empty header produced `""` and skipped
`x-real-ip`. Vercel always sets the header, so this is an edge case.

Done: the proxy's 429 carries both headers and the shared message, and an empty
forwarded address falls through to `x-real-ip`, then `"unknown"`. Both tested.

### A13. A sitewide refusal reads as a personal limit. low. left for Jake: needs a Worker redeploy

The Worker answers `{ allowed: false, retryAfter }` for all three limits. The
route can't tell "you sent 20 this hour" from "the site used its 50 for today",
so both say "Analysis limit reached". Telling them apart means adding a `scope`
field to the Worker's answer and redeploying it, which this pass doesn't do.

### A14. Address digests can outlive the hour. low. left for Jake: needs a Worker redeploy

The Worker deletes `hits` rows over an hour old only inside `fetch`, on the next
admission request. After a quiet stretch the last hour's digests stay in the
Durable Object until someone uses the app again. They are keyed HMACs, not raw
addresses, so the exposure is small, but `operations.md` said they "expire after
an hour". The doc now says what happens. A Durable Object alarm set an hour after
each write would make the hour exact. That needs a Worker deploy.

### A15. A failed generation still spends a limiter slot. low. left for Jake: product call

Admission is taken before the Gemini call, so a provider error, an empty
response or a client disconnect still counts against the visitor's 20 per hour
and the sitewide 50 per day. Refunding would need a second authenticated call to
the Worker and would let a client that aborts early avoid the limit. Probably
fine as is.

### A16. Provider errors mid-stream logged without the route's tag. low. fixed, see git log

`streamText` is lazy. A Gemini failure surfaces after the 200 has gone out, so
the route's `catch` never sees it. The AI SDK's default `onError` logs it with a
bare `console.error`, without the `AI_ROUTE_ERROR` prefix the rest of the route
uses, so a log search for that prefix missed these. The visitor already gets
"The AI returned an empty response" or the incomplete-result warning.

Done: an `onError` that logs with the `AI_ROUTE_ERROR` prefix.

### A17. The Worker's limits can drift from `lib/rateLimitConfig.ts`. low. fixed, see git log

The Worker hardcodes 20 per address per hour, and `proxy.ts` reads the same
numbers from `lib/rateLimitConfig.ts`. The Worker can't import the TypeScript
config, so nothing tied them together.

Done: a test reads `worker.mjs` and fails if its per-address count or window
differs from the config.

### A18. The proxy counts requests the route then refuses. low. no change

`proxy.ts` records a hit before the route checks the content type, size and
JSON, so a malformed request still uses one of that address's 20. The bucket is
per address, so this only affects the sender. Left alone.

### A19. Root layout errors fall back to Next's default page. low. no change

There is an `app/error.tsx` but no `app/global-error.tsx`. The layout is static
metadata, fonts and Analytics, with little that can throw. Not worth a file.

### A20. The Privacy panel does not mention rate limiting. low. left for Jake: disclosure wording

The panel covers Gemini, local history and analytics, but not that each
analysis request's address is checked by an in-memory limiter and, as a keyed
digest, by the Cloudflare Worker. Given A14, a line about this should be worded
by Jake. A draft that stays true today: "To limit abuse, each analysis request
is checked against usage limits. A keyed hash of your IP address is sent to our
limiter on Cloudflare and removed once it is over an hour old, the next time the
limiter runs."
