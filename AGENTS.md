<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes: APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Sermon Intelligence

Free web app for church media directors: paste a sermon transcript, get YouTube titles, descriptions, chapter markers, and social clip suggestions. Next.js 16 + React 19 + TypeScript, Tailwind v4, Vercel AI SDK with `@ai-sdk/google`, hosted on Vercel (hobby tier, auto-deploy from GitHub).

## Rules
- **Model is `gemini-3.5-flash-lite`.** Never use `gemini-2.0-flash`: it fails silently (app just returns to the homepage, no errors). Don't switch providers without comparing real transcripts against the system prompt's formatting rules first.
- YouTube transcript fetching was removed permanently (Vercel is blocked). Don't re-add it.
- Rate limiting is root `proxy.ts` (Next 16 middleware), config in `lib/rateLimitConfig.ts`.
- Don't hand-bump deps; Dependabot owns that. ESLint 10 and TypeScript 7 are held. Leave Dependabot security updates ungrouped.

## Commands
`npm run dev` · `npm test` · `npm run lint` · `npm run build`. Env: `GOOGLE_GENERATIVE_AI_API_KEY`.

## Read before working on...
- **System prompt, input normalization, clip slider, output parsing, bento cards:** `docs/agents/ai-pipeline.md`
- **Rate limiting, history/storage, public demo, deployment, analytics:** `docs/agents/operations.md`
- **File layout, coding patterns, debugging, common task recipes:** `docs/agents/code.md`
- **Alternative models under evaluation, contacts, Dependabot history:** `docs/agents/maintenance.md`

When you change something, update the matching doc, not this file.

## Agent gotchas

- **Worktrees need a real `npm ci`.** Symlinking `node_modules` from the main checkout passes `npm test` and `npm run lint`, but `npm run build` panics in Turbopack ("Symlink [project]/node_modules is invalid, it points out of the filesystem root").
- **Vercel previews are login-protected.** Don't sign in. Call the Vercel MCP tool `get_access_to_vercel_url` with the preview URL to get a temporary `?_vercel_share=` link (about 23h). Find the preview URL with `gh pr view <n> --json comments`.
