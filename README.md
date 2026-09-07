# Sermon Intelligence

Generate descriptions, YouTube chapters, and social clips from a sermon transcript.

Free tool: [sermonintelligence.com](https://sermonintelligence.com)

Built by [Overflow Creative](https://overflowcreative.net) for churches — paste in a transcript (or upload a Premiere/SRT/WebVTT export) and get back a YouTube description, timestamped chapters, and suggested social clip ranges.

## Stack

Next.js, TypeScript, Tailwind, and the Vercel AI SDK on Gemini.

## Environment variables

Set `GOOGLE_GENERATIVE_AI_API_KEY` (a Google Generative AI / Gemini API key) in
`.env.local` before running the app — the API route needs it to reach Gemini.

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your-key-here
```

## Running locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
