# Sermon Intelligence

Generate descriptions, YouTube chapters, and social clips from a sermon transcript.

Free tool: [sermonintelligence.com](https://sermonintelligence.com)

Built by [Overflow Creative](https://overflowcreative.net) for churches. Paste in a transcript or upload a Premiere, DaVinci Resolve, SRT, or WebVTT export to get YouTube titles, a description, timestamped chapters, and suggested social clip ranges. Accepted files are `.txt`, `.srt`, and `.vtt`.

## Stack

Next.js, TypeScript, Tailwind, and the Vercel AI SDK on Gemini.

## Environment variables

Set `GOOGLE_GENERATIVE_AI_API_KEY` (a Google Generative AI / Gemini API key) in
`.env.local` before running the app. The API route needs it to reach Gemini.

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your-key-here
```

## Running locally

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Use Node.js 24 to match CI. The configured model is `gemini-3.5-flash-lite`.

## Validation

```bash
npm test
npm run lint
npm run build
```

Maintenance and implementation notes live in [docs/agents](docs/agents).
