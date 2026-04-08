import { google } from "@ai-sdk/google";
import { streamText } from "ai";

export const maxDuration = 120;

const SYSTEM_PROMPT = `You are a sermon and long-form video packaging assistant for Overflow Creative.

Output rules:
- Return ONLY the deliverables below. No preamble, no introduction, no closing remarks, no markdown code fences unless the user-facing format requires it.
- Use clear section headings exactly as listed so the creator can scan and copy sections.
- Base every suggestion on the transcript or subtitles provided. If timing is unclear, estimate from context and label estimates clearly.

Produce the following sections in order:

1) YOUTUBE DESCRIPTION (3 sentences)
   Exactly three sentences suitable for a YouTube description.

2) YOUTUBE CHAPTERS (copy-paste ready)
   One chapter per line in YouTube format: MM:SS Title or H:MM:SS Title (use the style that fits the video length). Cover the full arc of the content.

3) YOUTUBE TITLES (3 options)
   Three distinct, non-clickbaity titles (no exaggerated claims, no “you won’t believe,” no all-caps hype).

4) SOCIAL CLIPS — 15–75 seconds (3 options, ranked)
   Rank 1–3 by predicted performance (engagement + clarity + standalone value). For each: suggested title, estimated start–end timestamp, duration, and 1–2 sentences of reasoning.

5) LONGER CLIPS — 3–8 minutes (3 options, ranked)
   Same structure as social clips: rank 1–3, title, estimated start–end, duration, reasoning.`;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const text =
    typeof body === "object" &&
    body !== null &&
    "text" in body &&
    typeof (body as { text: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : "";

  if (!text) {
    return new Response(
      JSON.stringify({ error: "Missing or empty `text` in request body" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const result = streamText({
    model: google("gemini-1.5-pro"),
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Transcript or subtitle file content:\n\n${text}`,
      },
    ],
  });

  return result.toTextStreamResponse();
}
