# Models, contacts, and dependency maintenance

### Under consideration: `gpt-5.6-luna` (not adopted, exploratory only)

Jake is evaluating OpenAI's `gpt-5.6-luna` as a possible alternative (2026-08-03).
Launched 2026-07-09 at $1/$6 per 1M input/output tokens; cut 80% on 2026-07-30 to
$0.20/$1.20 per 1M tokens. Still pricier per-token than `gemini-3.5-flash-lite`
(~$0.10/$0.40 per 1M), but at this app's traffic (rate-limited per IP per hour,
see `RATE_LIMIT_MAX_REQUESTS` in `lib/rateLimitConfig.ts`) the dollar difference
is cents/month either way — cost is not the deciding factor.

Switching would require adding an `@ai-sdk/openai` provider and reworking the
model init in `app/api/chat/route.ts`. Before switching, run a real transcript
through both models and compare adherence to the system prompt's strict
formatting rules (banned filler phrases, exact clip duration bounds, chapter
formatting) — pricing pages don't tell you that, and this project has already
been burned once by a model that silently failed (see `gemini-2.0-flash` above).
No decision made yet; revisit if/when explored further.

---

## Contact & Support

- **Creator:** Jake (Overflow Creative)
- **Feedback:** [Tally Form](https://tally.so/r/VL14Rg) (the form the app links to; `wkJPlj` is overflowcreative.net's contact form)
- **Instagram:** [@jake.crtv](https://www.instagram.com/jake.crtv/)
- **YouTube:** [@overflow.creative](https://www.youtube.com/@overflow.creative)

## Dependabot

- **Leave security updates ungrouped.** Grouped Dependabot titles carry no version pair, so `dependabot-auto-merge.yml` would hold every batch for a manual merge.
- The auto-merge workflow refused every Dependabot PR from 2026-09-07 while showing green; fixed 2026-09-30 (#39). Open alerts: 0 as of 2026-09-30, dependencies current.
- Held on purpose: ESLint 10 and TypeScript 7 (the native compiler needs its own session, not a bump).

---

**Last Updated:** 2026-08-30
**Status:** Active maintenance, occasional feature additions

## Dependency maintenance: 2026-10-01

Jake authorized an in-range npm refresh. Next and its ESLint config are 16.3.8,
AI SDK is 7.0.127, and the Google provider is 4.0.87. ESLint 10 and TypeScript 7
remain held. Lint, all 112 tests, and the production build pass. Audit reports
zero vulnerabilities. Jake authorized publishing these verified changes to main on 2026-10-01.

