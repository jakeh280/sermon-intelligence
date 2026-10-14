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

## Dependency maintenance: 2026-10-13

Jake asked for security bumps and an in-range refresh. Next and its ESLint config
16.4.0, AI SDK 7.0.139, Google provider 4.0.95, lucide-react 1.56.0. ESLint 10 and
TypeScript 7 remain held. Lint, all 112 tests and the production build pass;
`npm audit --omit=dev` reports zero. `braces` under `eslint-config-next` has no patched
release (build-time only; the only fix npm offers is a downgrade to 14.x). The AI route
was exercised end to end on the Vercel preview before merging, and on production after.
The Mac's `.env.local` was refreshed from the existing Google AI Studio key on
2026-10-13. Google's model metadata endpoint authenticated successfully and returned
`models/gemini-3.5-flash-lite`; no generation was requested. The file is gitignored
and owner-readable only. The connected Vercel project has protected Production and
Preview keys, with no Development key, so `vercel env pull .env.local` cannot restore
this local credential. Retrieve the existing key from Google AI Studio when needed.
